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
    confidence: 'medium',
  }],
  requiresMoreEvidence: false,
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

test('malformed Gemini envelopes are controlled errors; malformed model JSON is a safe no-match', () => {
  assert.throws(() => parseGeminiResponse('{'), (error) => error.code === 'AI_INVALID_RESPONSE');
  assert.throws(() => parseGeminiResponse(JSON.stringify({ candidates: [{}] })), AppError);
  assert.deepEqual(parseGeminiResponse(geminiEnvelope('not json')), {
    candidates: [],
    requiresMoreEvidence: true,
  });
  assert.deepEqual(parseGeminiResponse(geminiEnvelope(JSON.stringify({ candidates: [{ title: 7 }] }))), {
    candidates: [],
    requiresMoreEvidence: true,
  });
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
  stubRequest(t, timeout);
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  await assert.rejects(identifyScene([{ image: 'image-data' }]), (error) => error.code === 'AI_TIMEOUT');

  const previous = httpsRequest.requestHttps;
  httpsRequest.requestHttps = async () => { throw Object.assign(new Error('private upstream details'), { code: 'ECONNRESET' }); };
  t.after(() => { httpsRequest.requestHttps = previous; });
  await assert.rejects(identifyScene([{ image: 'image-data' }]), (error) => (
    error.code === 'AI_UNAVAILABLE' && !error.message.includes('private upstream details')
  ));
});

test('successful Gemini HTTP response with malformed envelope does not crash callers', async (t) => {
  stubRequest(t, { status: 200, body: '{"candidates":[{}]}' });
  await assert.rejects(identifyScene([{ image: 'image-data' }]), (error) => error.code === 'AI_INVALID_RESPONSE');
});
