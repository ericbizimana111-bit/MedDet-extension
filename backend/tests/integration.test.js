const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/app');
const { env, serviceStatus } = require('../src/config/env');
const { movieLimiter } = require('../src/middleware/rateLimit.middleware');
const identification = require('../src/services/identification.service');
const gemini = require('../src/services/gemini.service');
const tmdb = require('../src/services/tmdb.service');
const httpsRequest = require('../src/utils/httpsRequest');

const image = fs.readFileSync(path.resolve(__dirname, '../../extension/icons/16.png')).toString('base64');

async function startServer(t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health endpoint reports server status and configured service readiness', async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/api/v1/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, data: { status: 'ok', services: serviceStatus() } });
  for (const key of ['movie', 'music', 'gemini', 'tmdb', 'acrcloud']) assert.equal(typeof body.data.services[key], 'boolean');
});

test('movie endpoint rejects missing, malformed, and unsupported image input before services', async (t) => {
  const base = await startServer(t);
  const original = identification.identifyMovie;
  identification.identifyMovie = async () => { throw new Error('must not be called for invalid input'); };
  t.after(() => { identification.identifyMovie = original; });

  for (const payload of [
    {},
    { frames: [{ image: 'x'.repeat(120) }] },
    { frames: [{ image, mimeType: 'image/gif' }] },
  ]) {
    const response = await fetch(`${base}/api/v1/identify/movie`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_INPUT');
  }
});

test('valid movie request reaches the controller and returns the established response shape', async (t) => {
  const base = await startServer(t);
  const original = identification.identifyMovie;
  identification.identifyMovie = async ({ frames }) => {
    assert.equal(frames[0].image, image);
    return { status: 'no_match', matches: [] };
  };
  t.after(() => { identification.identifyMovie = original; });

  const response = await fetch(`${base}/api/v1/identify/movie`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ frames: [{ image }], platform: 'other' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { type: 'movie', status: 'no_match', matches: [] },
  });
});

test('movie identification verifies candidate and applies confidence matching', async (t) => {
  const originalGemini = gemini.identifyScene;
  const originalVerify = tmdb.verifyCandidate;
  const originalDetails = tmdb.getDetails;
  gemini.identifyScene = async () => ({
    candidates: [{
      title: 'Example',
      releaseYear: 2020,
      mediaType: 'movie',
      confidence: 'high',
      evidence: ['A red car is visible', 'The same distinctive driver appears in both frames'],
      actorsOrCharacters: ['Unidentified driver'],
      sceneDescription: 'A driver sits in a red car.',
    }],
  });
  tmdb.verifyCandidate = async () => ({
    type: 'movie',
    id: 12,
    score: 0.95,
    titleMatch: 'exact',
    yearMatch: 'same',
  });
  tmdb.getDetails = async () => ({ tmdbId: 12, title: 'Example' });
  t.after(() => {
    gemini.identifyScene = originalGemini;
    tmdb.verifyCandidate = originalVerify;
    tmdb.getDetails = originalDetails;
  });

  const result = await identification.identifyMovie({ frames: [{ image }] });
  assert.equal(result.status, 'completed');
  assert.equal(result.matches[0].matchLevel, 'high');
  assert.deepEqual(result.matches[0].evidence, [
    'A red car is visible',
    'The same distinctive driver appears in both frames',
  ]);
});

test('movie workflow requests more evidence before TMDB and permits only one user-triggered second analysis', async (t) => {
  const originalGemini = gemini.identifyScene;
  const originalVerify = tmdb.verifyCandidate;
  const originalDetails = tmdb.getDetails;
  const firstFrame = { image, timestamp: 1 };
  const secondFrame = { image: image.replace(/.$/, 'A'), timestamp: 2 };
  let geminiCalls = 0;
  let verifyCalls = 0;
  gemini.identifyScene = async (frames, options) => {
    geminiCalls += 1;
    if (geminiCalls === 1) {
      return {
        candidates: [{ title: 'Example', mediaType: 'movie', confidence: 'medium', evidence: ['A red car is visible'] }],
        requiresMoreEvidence: true,
        uncertaintyReason: 'Only one distinctive clue is visible.',
      };
    }
    assert.equal(frames.length, 2);
    assert.equal(options.priorCandidates[0].title, 'Example');
    return {
      candidates: [{
        title: 'Example',
        mediaType: 'movie',
        confidence: 'high',
        evidence: ['A red car is visible', 'The same distinctive driver appears in both frames'],
      }],
      requiresMoreEvidence: false,
    };
  };
  tmdb.verifyCandidate = async () => {
    verifyCalls += 1;
    return { type: 'movie', id: 12, score: 1, titleMatch: 'exact', yearMatch: 'same' };
  };
  tmdb.getDetails = async () => ({ tmdbId: 12, title: 'Example' });
  t.after(() => {
    gemini.identifyScene = originalGemini;
    tmdb.verifyCandidate = originalVerify;
    tmdb.getDetails = originalDetails;
  });

  const first = await identification.identifyMovie({ pass: 'initial', frames: [firstFrame] });
  assert.equal(first.status, 'insufficient_evidence');
  assert.equal(first.matches.length, 0);
  assert.equal(first.candidates[0].title, 'Example');
  assert.equal(typeof first.sessionId, 'string');
  assert.equal(verifyCalls, 0);

  const second = await identification.identifyMovie({
    pass: 'additional',
    sessionId: first.sessionId,
    priorFrames: [firstFrame],
    frames: [secondFrame],
  });
  assert.equal(second.status, 'completed');
  assert.equal(geminiCalls, 2);
  assert.equal(verifyCalls, 1);
  await assert.rejects(identification.identifyMovie({
    pass: 'additional',
    sessionId: first.sessionId,
    priorFrames: [firstFrame],
    frames: [secondFrame],
  }), (error) => error.code === 'SESSION_COMPLETE');
  assert.equal(geminiCalls, 2);
});

test('movie analysis does not issue a second attempt automatically after an upstream failure', async (t) => {
  const originalGemini = gemini.identifyScene;
  const originalVerify = tmdb.verifyCandidate;
  let calls = 0;
  gemini.identifyScene = async () => {
    calls += 1;
    throw Object.assign(new Error('temporary outage'), { code: 'AI_UNAVAILABLE' });
  };
  tmdb.verifyCandidate = async () => { throw new Error('TMDB must not run'); };
  t.after(() => {
    gemini.identifyScene = originalGemini;
    tmdb.verifyCandidate = originalVerify;
  });
  await assert.rejects(identification.identifyMovie({ pass: 'initial', frames: [{ image }] }), (error) => error.code === 'AI_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('music endpoint accepts validated audio but reports missing ACRCloud configuration', async (t) => {
  const base = await startServer(t);
  if (serviceStatus().music) {
    t.skip('ACRCloud is configured; avoid making an unmocked paid request');
    return;
  }
  const originalError = console.error;
  const oldDailyLimit = env.limits.dailyGlobal;
  console.error = () => {};
  env.limits.dailyGlobal = 0;
  t.after(() => {
    console.error = originalError;
    env.limits.dailyGlobal = oldDailyLimit;
  });

  const response = await fetch(`${base}/api/v1/identify/music`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: Buffer.alloc(100).toString('base64'), mimeType: 'audio/wav' }),
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'ACR_NOT_CONFIGURED');

  const invalid = await fetch(`${base}/api/v1/identify/music`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: '!'.repeat(120), mimeType: 'audio/wav' }),
  });
  assert.equal(invalid.status, 400);
});

test('TMDB uses IPv4 HTTPS helper and validates upstream status and JSON', async (t) => {
  const oldKey = env.tmdb.apiKey;
  const originalRequest = httpsRequest.requestHttps;
  env.tmdb.apiKey = 'test-key';
  httpsRequest.requestHttps = async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.themoviedb.org');
    assert.equal(options.timeoutMs, 10_000);
    return { status: 200, body: '{"results":[]}' };
  };
  t.after(() => {
    env.tmdb.apiKey = oldKey;
    httpsRequest.requestHttps = originalRequest;
  });
  assert.equal(await tmdb.verifyCandidate({ title: 'Unknown', mediaType: 'movie' }), null);
});

test('route failures preserve safe status codes and security headers', async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/missing`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('movie endpoint rate limit rejects requests beyond its configured per-IP budget', async (t) => {
  const base = await startServer(t);
  const limit = env.limits.perHour;
  await movieLimiter.resetKey('127.0.0.1');
  for (let i = 0; i <= limit; i += 1) {
    const response = await fetch(`${base}/api/v1/identify/movie`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (i < limit) assert.equal(response.status, 400);
    else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).error.code, 'RATE_LIMITED');
    }
  }
  await movieLimiter.resetKey('127.0.0.1');
});

test('daily paid-service cap rejects validated requests when the relevant API is configured', async (t) => {
  const base = await startServer(t);
  const oldKey = env.gemini.apiKey;
  const oldDailyLimit = env.limits.dailyGlobal;
  env.gemini.apiKey = 'test-key';
  env.limits.dailyGlobal = 0;
  t.after(() => {
    env.gemini.apiKey = oldKey;
    env.limits.dailyGlobal = oldDailyLimit;
  });

  const response = await fetch(`${base}/api/v1/identify/movie`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ frames: [{ image }] }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DAILY_CAPACITY');
});
