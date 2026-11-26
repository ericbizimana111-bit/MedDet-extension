const test = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('../src/config/env');
const httpsRequest = require('../src/utils/httpsRequest');
const tmdb = require('../src/services/tmdb.service');
const acr = require('../src/services/acrcloud.service');
const { tmdbImage } = tmdb;

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

test('TMDB retries transient 503 responses at most twice', async (t) => {
  const originalRequest = httpsRequest.requestHttps;
  const originalKey = env.tmdb.apiKey;
  const originalWarn = console.warn;
  let calls = 0;
  env.tmdb.apiKey = 'test-key';
  console.warn = () => {};
  httpsRequest.requestHttps = async (_url, options) => {
    calls += 1;
    assert.ok(options.totalTimeoutMs > 0 && options.totalTimeoutMs <= 10_000);
    return calls < 3
      ? { status: 503, body: '{}' }
      : { status: 200, body: JSON.stringify({ results: [] }) };
  };
  t.after(() => {
    httpsRequest.requestHttps = originalRequest;
    env.tmdb.apiKey = originalKey;
    console.warn = originalWarn;
  });

  assert.equal(await tmdb.verifyCandidate({ title: 'Example', mediaType: 'movie' }), null);
  assert.equal(calls, 3);
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

test('TMDB details return official movie and TV artwork from existing detail responses', async (t) => {
  const originalRequest = httpsRequest.requestHttps;
  const originalKey = env.tmdb.apiKey;
  env.tmdb.apiKey = 'test-key';
  const details = [
    {
      id: 3,
      title: 'Animated Film',
      release_date: '2021-06-01',
      poster_path: '/film-poster.jpg',
      backdrop_path: '/film-backdrop.jpg',
      genres: [{ name: 'Animation' }],
      credits: { crew: [], cast: [] },
    },
    {
      id: 4,
      name: 'Anime Series',
      first_air_date: '2022-01-01',
      poster_path: '/anime-poster.png',
      backdrop_path: null,
      genres: [{ name: 'Animation' }],
      credits: { crew: [], cast: [] },
    },
    {
      id: 5,
      title: 'No Artwork',
      poster_path: '../unsafe.jpg',
      backdrop_path: 'https://example.com/image.jpg',
      credits: { crew: [], cast: [] },
    },
  ];
  httpsRequest.requestHttps = async (url) => {
    const parsed = new URL(url);
    assert.match(parsed.pathname, /^\/3\/(?:movie|tv)\/\d+$/);
    return { status: 200, body: JSON.stringify(details.shift()) };
  };
  t.after(() => {
    httpsRequest.requestHttps = originalRequest;
    env.tmdb.apiKey = originalKey;
  });

  const movie = await tmdb.getDetails('movie', 3);
  assert.equal(movie.poster, 'https://image.tmdb.org/t/p/w342/film-poster.jpg');
  assert.equal(movie.backdrop, 'https://image.tmdb.org/t/p/w780/film-backdrop.jpg');
  assert.deepEqual(movie.genres, ['Animation']);

  const tv = await tmdb.getDetails('tv', 4);
  assert.equal(tv.mediaType, 'tv');
  assert.equal(tv.title, 'Anime Series');
  assert.equal(tv.poster, 'https://image.tmdb.org/t/p/w342/anime-poster.png');
  assert.equal(tv.backdrop, null);
  assert.deepEqual(tv.genres, ['Animation']);

  const absent = await tmdb.getDetails('movie', 5);
  assert.equal(absent.poster, null);
  assert.equal(absent.backdrop, null);
});

test('TMDB image resolver rejects missing, malformed, and unsupported paths or sizes', () => {
  assert.equal(tmdbImage(null, 'w342'), null);
  assert.equal(tmdbImage('https://example.com/image.jpg', 'w780'), null);
  assert.equal(tmdbImage('/../../unsafe.jpg', 'w342'), null);
  assert.equal(tmdbImage('/poster.gif', 'w342'), null);
  assert.equal(tmdbImage('/poster.jpg', 'unknown'), null);
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
