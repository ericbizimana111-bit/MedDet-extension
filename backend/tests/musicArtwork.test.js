const test = require('node:test');
const assert = require('node:assert/strict');
const httpsRequest = require('../src/utils/httpsRequest');
const artwork = require('../src/services/musicArtwork.service');
const identification = require('../src/services/identification.service');
const acrcloud = require('../src/services/acrcloud.service');

const validUrl = 'https://is1-ssl.mzstatic.com/image/thumb/Music123/cover.jpg';
const track = {
  title: 'My Song',
  artists: ['Primary Artist'],
  album: 'My Album',
  releaseDate: '2024-02-10',
};

test('music artwork helper requires exact track title and artist', () => {
  const base = { kind: 'song', trackName: 'My Song', artistName: 'Primary Artist', artworkUrl100: validUrl };
  assert.equal(artwork.matchResult(track, base)?.artworkUrl, validUrl);
  assert.equal(artwork.matchResult(track, { ...base, trackName: 'Other Song' }), null);
  assert.equal(artwork.matchResult(track, { ...base, artistName: 'Wrong Artist' }), null);
  assert.equal(artwork.matchResult(track, { ...base, artworkUrl100: 'https://example.com/fake.jpg' }), null);
});

test('music artwork helper prefers album and ranks single or alternative releases', () => {
  const album = artwork.matchResult(track, {
    kind: 'song', trackName: 'My Song', artistName: 'Primary Artist',
    collectionName: 'My Album', releaseDate: '2024-02-10', artworkUrl100: validUrl,
  });
  assert.equal(album.artworkType, 'album');
  const single = artwork.matchResult({ ...track, album: null }, {
    kind: 'song', trackName: 'My Song', artistName: 'Primary Artist',
    collectionName: 'My Song', releaseDate: '2024-02-10', artworkUrl100: validUrl,
  });
  assert.equal(single.artworkType, 'single');
  const alternative = artwork.matchResult(track, {
    kind: 'song', trackName: 'My Song', artistName: 'Primary Artist',
    collectionName: 'Remastered Hits', releaseDate: '2024-02-10', artworkUrl100: validUrl,
  });
  assert.equal(alternative.artworkType, 'alternative_release');
});

test('music artwork URL validation rejects missing, malformed, and unrelated hosts', () => {
  assert.equal(artwork.imageUrl(null), null);
  assert.equal(artwork.imageUrl(''), null);
  assert.equal(artwork.imageUrl('https://example.com/cover.jpg'), null);
  assert.equal(artwork.imageUrl('http://is1-ssl.mzstatic.com/image/thumb/Music123/cover.jpg'), null);
  assert.equal(artwork.imageUrl(validUrl + '?size=large'), null);
  assert.equal(artwork.imageUrl(validUrl), validUrl);
});

test('music artwork lookup is optional and does not run without track and artist', async (t) => {
  const original = httpsRequest.requestHttps;
  let called = false;
  httpsRequest.requestHttps = async () => { called = true; return { status: 200, body: '{}' }; };
  t.after(() => { httpsRequest.requestHttps = original; });
  assert.equal(await artwork.findArtwork({ title: 'Song', artists: [] }), null);
  assert.equal(called, false);
});

test('music artwork lookup accepts exact iTunes results and caches no metadata for failures', async (t) => {
  const original = httpsRequest.requestHttps;
  t.after(() => { httpsRequest.requestHttps = original; });

  httpsRequest.requestHttps = async (url, options) => {
    assert.equal(new URL(url).hostname, 'itunes.apple.com');
    assert.equal(options.timeoutMs, 5_000);
    assert.equal(options.totalTimeoutMs, 5_000);
    return {
      status: 200,
      body: JSON.stringify({
        results: [
          { kind: 'song', trackName: 'Wrong Song', artistName: 'Primary Artist', artworkUrl100: validUrl },
          {
            kind: 'song',
            trackName: 'Lookup Song',
            artistName: 'Lookup Artist',
            collectionName: 'Lookup Album',
            releaseDate: '2024-02-10T00:00:00Z',
            artworkUrl100: validUrl,
            primaryGenreName: 'Pop',
          },
        ],
      }),
    };
  };

  const lookupTrack = {
    title: 'Lookup Song',
    artists: ['Lookup Artist'],
    album: 'Lookup Album',
    releaseDate: '2024-02-10',
  };
  const found = await artwork.findArtwork(lookupTrack);
  assert.equal(found.artworkUrl, validUrl);
  assert.equal(found.artworkProvider, 'iTunes');
  assert.equal(found.artworkType, 'album');
  assert.equal(found.artworkGenre, 'Pop');

  httpsRequest.requestHttps = async () => ({ status: 503, body: '{}' });
  assert.equal(await artwork.findArtwork({
    title: 'Unavailable Lookup',
    artists: ['Unavailable Artist'],
  }), null);
});

test('music identification preserves ACRCloud success and adds optional artwork fields', async (t) => {
  const originalAcr = acrcloud.identifyAudio;
  const originalArtwork = artwork.findArtwork;
  t.after(() => {
    acrcloud.identifyAudio = originalAcr;
    artwork.findArtwork = originalArtwork;
  });

  acrcloud.identifyAudio = async () => ({
    found: true,
    track: {
      title: 'My Song',
      artists: ['Primary Artist'],
      album: 'My Album',
      releaseDate: '2024-02-10',
      releaseYear: 2024,
      genre: 'Pop',
      confidence: 'high',
      confidenceScore: 96,
    },
  });
  artwork.findArtwork = async () => ({
    artworkUrl: validUrl,
    artworkProvider: 'iTunes',
    artworkType: 'album',
    artworkAlbum: 'My Album',
    artworkReleaseYear: 2024,
  });

  const result = await identification.identifyMusic({
    audio: Buffer.from('audio').toString('base64'),
    mimeType: 'audio/wav',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.track.title, 'My Song');
  assert.equal(result.track.artworkUrl, validUrl);
  assert.equal(result.track.artworkProvider, 'iTunes');
  assert.equal(result.track.artworkType, 'album');

  artwork.findArtwork = async () => null;
  const fallback = await identification.identifyMusic({
    audio: Buffer.from('audio').toString('base64'),
    mimeType: 'audio/wav',
  });
  assert.equal(fallback.status, 'completed');
  assert.equal(fallback.track.artworkUrl, null);
  assert.equal(fallback.track.artworkProvider, null);
});
