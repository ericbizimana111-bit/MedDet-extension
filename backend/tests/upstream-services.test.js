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

test('TMDB verifies media type and year, then checks bounded alternative titles when needed', async (t) => {
  const originalRequest = httpsRequest.requestHttps;
  const originalKey = env.tmdb.apiKey;
  env.tmdb.apiKey = 'test-key';
  const calls = [];
  httpsRequest.requestHttps = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname === '/3/search/tv') {
      assert.equal(parsed.searchParams.get('first_air_date_year'), '2020');
      return { status: 200, body: JSON.stringify({ results: [{ id: 8, name: 'Example Series', first_air_date: '2020-01-02' }] }) };
    }
    if (parsed.pathname === '/3/search/movie') {
      return { status: 200, body: JSON.stringify({ results: [{ id: 9, title: 'Original Film', release_date: '2010-01-02' }] }) };
    }
    if (parsed.pathname === '/3/movie/9/alternative_titles') {
      return { status: 200, body: JSON.stringify({ titles: [{ title: 'Local Film Title' }] }) };
    }
    throw new Error(`Unexpected TMDB path ${parsed.pathname}`);
  };
  t.after(() => {
    httpsRequest.requestHttps = originalRequest;
    env.tmdb.apiKey = originalKey;
  });

  const tv = await tmdb.verifyCandidate({ title: 'Example Series', releaseYear: 2020, mediaType: 'tv' });
  assert.equal(tv.type, 'tv');
  assert.equal(tv.titleMatch, 'exact');
  assert.equal(tv.yearMatch, 'same');

  const movie = await tmdb.verifyCandidate({ title: 'Local Film Title', releaseYear: 2010, mediaType: 'movie' });
  assert.equal(movie.type, 'movie');
  assert.equal(movie.matchedByAlternativeTitle, true);
  assert.equal(movie.titleMatch, 'exact');
  assert.equal(movie.yearMatch, 'same');
  assert.equal(calls.filter((url) => url.pathname === '/3/search/movie').length, 2);
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
