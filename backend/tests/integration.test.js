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
      evidence: ['A red car is visible'],
    }],
  });
  tmdb.verifyCandidate = async () => ({ type: 'movie', id: 12, score: 0.95 });
  tmdb.getDetails = async () => ({ tmdbId: 12, title: 'Example' });
  t.after(() => {
    gemini.identifyScene = originalGemini;
    tmdb.verifyCandidate = originalVerify;
    tmdb.getDetails = originalDetails;
  });

  const result = await identification.identifyMovie({ frames: [{ image }] });
  assert.equal(result.status, 'completed');
  assert.equal(result.matches[0].matchLevel, 'high');
  assert.deepEqual(result.matches[0].evidence, ['A red car is visible']);
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
