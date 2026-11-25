const test = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config/env');
const httpsRequest = require('../src/utils/httpsRequest');
const tmdb = require('../src/services/tmdb.service');
const acr = require('../src/services/acrcloud.service');

test('TMDB reports upstream HTTP, network, and malformed JSON errors cleanly', async (t) => {
  const originalRequest = httpsRequest.requestHttps;
  const originalKey = env.tmdb.apiKey;
  env.tmdb.apiKey = 'test-key';
  t.after(() => {
    httpsRequest.requestHttps = originalRequest;
    env.tmdb.apiKey = originalKey;
  });

  for (const [response, code] of [
    [{ status: 401, body: '{}' }, 'TMDB_REJECTED'],
    [{ status: 429, body: '{}' }, 'METADATA_BUSY'],
    [{ status: 503, body: '{}' }, 'METADATA_UNAVAILABLE'],
    [{ status: 200, body: 'not-json' }, 'METADATA_INVALID_RESPONSE'],
  ]) {
    httpsRequest.requestHttps = async () => response;
    await assert.rejects(tmdb.verifyCandidate({ title: 'Example', mediaType: 'movie' }), (error) => error.code === code);
  }
  httpsRequest.requestHttps = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); };
  await assert.rejects(tmdb.verifyCandidate({ title: 'Example', mediaType: 'movie' }), (error) => error.code === 'METADATA_TIMEOUT');
  httpsRequest.requestHttps = async () => { throw Object.assign(new Error('connection failed'), { code: 'ECONNRESET' }); };
  await assert.rejects(tmdb.verifyCandidate({ title: 'Example', mediaType: 'movie' }), (error) => error.code === 'METADATA_UNAVAILABLE');
});

test('ACRCloud signs and posts multipart audio through the IPv4 HTTPS client', async (t) => {
  const originalRequest = httpsRequest.requestHttps;
  const originalAcr = { ...env.acr };
  Object.assign(env.acr, { host: 'identify.example.test', accessKey: 'test-access', accessSecret: 'test-secret' });
  let request;
  httpsRequest.requestHttps = async (url, options) => {
    request = { url, options };
    return {
      status: 200,
      body: JSON.stringify({
        status: { code: 0 },
        metadata: { music: [{ title: 'Song', artists: [{ name: 'Artist' }] }] },
      }),
    };
  };
  t.after(() => {
    httpsRequest.requestHttps = originalRequest;
    Object.assign(env.acr, originalAcr);
  });

  const result = await acr.identifyAudio(Buffer.from('audio bytes'), 'audio/wav');
  assert.equal(new URL(request.url).hostname, 'identify.example.test');
  assert.equal(request.options.method, 'POST');
  assert.match(request.options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.equal(request.options.timeoutMs, 20_000);
  assert.equal(request.options.body.includes(Buffer.from('test-access')), true);
  assert.deepEqual(result.track.artists, ['Artist']);
});

test('ACRCloud handles malformed responses and service-level failures', async (t) => {
  const originalRequest = httpsRequest.requestHttps;
  const originalAcr = { ...env.acr };
  Object.assign(env.acr, { host: 'identify.example.test', accessKey: 'test-access', accessSecret: 'test-secret' });
  t.after(() => {
    httpsRequest.requestHttps = originalRequest;
    Object.assign(env.acr, originalAcr);
  });

  httpsRequest.requestHttps = async () => ({ status: 200, body: '{' });
  await assert.rejects(acr.identifyAudio(Buffer.from('audio')), (error) => error.code === 'MUSIC_INVALID_RESPONSE');
  httpsRequest.requestHttps = async () => ({ status: 503, body: '{}' });
  await assert.rejects(acr.identifyAudio(Buffer.from('audio')), (error) => error.code === 'MUSIC_UNAVAILABLE');
  httpsRequest.requestHttps = async () => ({ status: 200, body: JSON.stringify({ status: { code: 3001 } }) });
  await assert.rejects(acr.identifyAudio(Buffer.from('audio')), (error) => error.code === 'ACR_REJECTED');
});
