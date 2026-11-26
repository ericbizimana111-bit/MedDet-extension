const test = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config/env');
const AppError = require('../src/utils/AppError');
const httpsRequest = require('../src/utils/httpsRequest');
const { identifyScene, parseGeminiResponse } = require('../src/services/gemini.service');

const validModelResult = {
  candidates: [{
    title: 'Example',
    releaseYear: 2020,
    mediaType: 'movie',
    evidence: ['A red car is visible'],
    actorsOrCharacters: ['Unidentified driver'],
    sceneDescription: 'A driver sits in a red car.',
    timestamps: [],
    confidence: 'medium',
  }],
  requiresMoreEvidence: false,
  uncertaintyReason: '',
};

function geminiEnvelope(text) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
}

function stubRequest(t, responseOrError) {
  const previous = httpsRequest.requestHttps;
  const previousKey = env.gemini.apiKey;
  env.gemini.apiKey = 'test-key';
  httpsRequest.requestHttps = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.timeoutMs, 40_000);
    assert.ok(options.totalTimeoutMs > 0 && options.totalTimeoutMs <= 42_000);
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    if (responseOrError instanceof Error) throw responseOrError;
    return responseOrError;
  };
  t.after(() => {
    httpsRequest.requestHttps = previous;
    env.gemini.apiKey = previousKey;
  });
}

test('Gemini response is parsed and validated against the candidate schema', () => {
  const result = parseGeminiResponse(geminiEnvelope(JSON.stringify(validModelResult)));
  assert.equal(result.candidates[0].title, 'Example');
  assert.equal(result.candidates[0].confidence, 'medium');
});

test('malformed Gemini envelopes and model output are explicit invalid-response errors', () => {
  assert.throws(() => parseGeminiResponse('{'), (error) => error.code === 'AI_INVALID_RESPONSE');
  assert.throws(() => parseGeminiResponse(JSON.stringify({ candidates: [{}] })), AppError);
  assert.throws(() => parseGeminiResponse(geminiEnvelope('not json')), (error) => error.code === 'AI_INVALID_RESPONSE');
  assert.throws(() => parseGeminiResponse(geminiEnvelope(JSON.stringify({ candidates: [{ title: 7 }] }))), (error) => error.code === 'AI_INVALID_RESPONSE');
  assert.throws(() => parseGeminiResponse(geminiEnvelope('')), (error) => error.code === 'AI_EMPTY_RESPONSE');
  assert.throws(() => parseGeminiResponse(''), (error) => error.code === 'AI_EMPTY_RESPONSE');
  assert.throws(() => parseGeminiResponse(JSON.stringify({ candidates: [] })), (error) => error.code === 'AI_EMPTY_RESPONSE');
  assert.throws(() => parseGeminiResponse(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })), (error) => error.code === 'AI_BLOCKED');
  assert.throws(() => parseGeminiResponse(JSON.stringify({
    candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: JSON.stringify(validModelResult) }] } }],
  })), (error) => error.code === 'AI_BLOCKED');
  assert.throws(() => parseGeminiResponse(JSON.stringify({
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(validModelResult) }] } }],
  })), (error) => error.code === 'AI_INVALID_RESPONSE');
  assert.throws(() => parseGeminiResponse(geminiEnvelope(JSON.stringify({
    ...validModelResult,
    candidates: [{ ...validModelResult.candidates[0], mediaType: 'documentary' }],
  }))), (error) => error.code === 'AI_INVALID_RESPONSE');
  assert.throws(() => parseGeminiResponse(geminiEnvelope(JSON.stringify({
    ...validModelResult,
    candidates: [{ ...validModelResult.candidates[0], unsupportedClaim: 'invented' }],
  }))), (error) => error.code === 'AI_INVALID_RESPONSE');
});

test('Gemini maps rejected, quota, busy, and unexpected upstream statuses safely', async (t) => {
  for (const [status, code] of [
    [400, 'AI_REJECTED'],
    [403, 'AI_REJECTED'],
    [429, 'AI_QUOTA'],
    [503, 'AI_BUSY'],
    [500, 'AI_UNAVAILABLE'],
  ]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      stubRequest(subtest, { status, body: '{"error":{"message":"do not log this body"}}' });
      const originalError = console.error;
      console.error = () => {};
      subtest.after(() => { console.error = originalError; });
      await assert.rejects(identifyScene([{ image: 'image-data', mimeType: 'image/png' }]), (error) => error.code === code);
    });
  }
});

test('Gemini network timeout and connection failures do not expose upstream details', async (t) => {
  const timeout = Object.assign(new Error('request timeout'), { code: 'ETIMEDOUT' });
  let timeoutCalls = 0;
  stubRequest(t, timeout);
  const timedOutRequest = httpsRequest.requestHttps;
  httpsRequest.requestHttps = async (...args) => {
    timeoutCalls += 1;
    return timedOutRequest(...args);
  };
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  await assert.rejects(identifyScene([{ image: 'image-data' }]), (error) => error.code === 'AI_TIMEOUT');
  assert.equal(timeoutCalls, 3);

  let resetCalls = 0;
  httpsRequest.requestHttps = async () => {
    resetCalls += 1;
    throw Object.assign(new Error('private upstream details'), { code: 'ECONNRESET' });
  };
  await assert.rejects(identifyScene([{ image: 'image-data' }]), (error) => (
    error.code === 'AI_UNAVAILABLE' && !error.message.includes('private upstream details')
  ));
  assert.equal(resetCalls, 3);
});

test('successful Gemini HTTP response with malformed envelope does not crash callers', async (t) => {
  stubRequest(t, { status: 200, body: '{"candidates":[{}]}' });
  await assert.rejects(identifyScene([{ image: 'image-data' }]), (error) => error.code === 'AI_INVALID_RESPONSE');
});

test('Gemini retries transient 503 responses at most twice before succeeding', async (t) => {
  const previous = httpsRequest.requestHttps;
  const previousKey = env.gemini.apiKey;
  const originalWarn = console.warn;
  let calls = 0;
  env.gemini.apiKey = 'test-key';
  console.warn = () => {};
  httpsRequest.requestHttps = async () => {
    calls += 1;
    return calls < 3
      ? { status: 503, body: '{}' }
      : { status: 200, body: geminiEnvelope(JSON.stringify(validModelResult)) };
  };
  t.after(() => {
    httpsRequest.requestHttps = previous;
    env.gemini.apiKey = previousKey;
    console.warn = originalWarn;
  });

  const result = await identifyScene([{ image: 'image-data' }]);
  assert.equal(result.candidates[0].title, 'Example');
  assert.equal(calls, 3);
});

test('Gemini retries transient 502 and 504 responses', async (t) => {
  const previous = httpsRequest.requestHttps;
  const previousKey = env.gemini.apiKey;
  const originalWarn = console.warn;
  env.gemini.apiKey = 'test-key';
  console.warn = () => {};
  t.after(() => {
    httpsRequest.requestHttps = previous;
    env.gemini.apiKey = previousKey;
    console.warn = originalWarn;
  });

  for (const status of [502, 504]) {
    let calls = 0;
    httpsRequest.requestHttps = async () => {
      calls += 1;
      return calls === 1
        ? { status, body: '{}' }
        : { status: 200, body: geminiEnvelope(JSON.stringify(validModelResult)) };
    };
    const result = await identifyScene([{ image: 'image-data' }]);
    assert.equal(result.candidates[0].title, 'Example');
    assert.equal(calls, 2);
  }
});

test('Gemini sends time-ordered inline images and prior candidates for reassessment', async (t) => {
  const previous = httpsRequest.requestHttps;
  const previousKey = env.gemini.apiKey;
  env.gemini.apiKey = 'test-key';
  httpsRequest.requestHttps = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.contents[0].parts[0].text, /Ignore TikTok, Instagram and YouTube/);
    assert.match(body.contents[0].parts[1].text, /platform":"instagram/);
    assert.match(body.contents[0].parts[2].text, /Prior unconfirmed candidates/);
    assert.equal(body.contents[0].parts[4].inlineData.data, 'first');
    assert.equal(body.contents[0].parts[6].inlineData.data, 'second');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(typeof body.generationConfig.responseJsonSchema, 'object');
    return {
      status: 200,
      body: geminiEnvelope(JSON.stringify({
        ...validModelResult,
        candidates: [{ ...validModelResult.candidates[0], timestamps: [2] }],
      })),
    };
  };
  t.after(() => {
    httpsRequest.requestHttps = previous;
    env.gemini.apiKey = previousKey;
  });

  await identifyScene([
    { image: 'first', timestamp: 1, mimeType: 'image/jpeg' },
    { image: 'second', timestamp: 2, mimeType: 'image/jpeg' },
  ], {
    priorCandidates: [validModelResult.candidates[0]],
    platform: 'instagram',
    videoContext: { currentTime: 3, duration: 12, width: 720, height: 1280 },
  });
});

test('Gemini rejects candidate timestamps that do not match an input frame', async (t) => {
  const previous = httpsRequest.requestHttps;
  const previousKey = env.gemini.apiKey;
  env.gemini.apiKey = 'test-key';
  httpsRequest.requestHttps = async () => ({
    status: 200,
    body: geminiEnvelope(JSON.stringify({
      ...validModelResult,
      candidates: [{ ...validModelResult.candidates[0], timestamps: [99] }],
    })),
  });
  t.after(() => {
    httpsRequest.requestHttps = previous;
    env.gemini.apiKey = previousKey;
  });
  await assert.rejects(
    identifyScene([{ image: 'image-data', timestamp: 2 }]),
    (error) => error.code === 'AI_INVALID_RESPONSE'
  );
});
