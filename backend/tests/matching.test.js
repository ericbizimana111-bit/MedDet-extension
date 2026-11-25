const test = require('node:test');
const assert = require('node:assert');
const { normalizeTitle, scoreTmdbResult, matchLevel } = require('../src/utils/matching');
const { normalizeTrack } = require('../src/services/acrcloud.service');

test('normalizeTitle ignores articles, case, punctuation, accents', () => {
  assert.strictEqual(normalizeTitle('The Dark Knight'), 'dark knight');
  assert.strictEqual(normalizeTitle('Amélie'), 'amelie');
  assert.strictEqual(normalizeTitle('Fast & Furious'), 'fast and furious');
});

test('exact title + same year scores high', () => {
  const s = scoreTmdbResult({ title: 'Inception', releaseYear: 2010 }, { title: 'Inception', release_date: '2010-07-15' });
  assert.ok(s >= 0.95);
});

test('wrong title scores zero even if it is the first search result', () => {
  assert.strictEqual(scoreTmdbResult({ title: 'Inception', releaseYear: 2010 }, { title: 'Interstellar', release_date: '2014-11-05' }), 0);
});

test('year mismatch lowers the score', () => {
  const same = scoreTmdbResult({ title: 'Halloween', releaseYear: 1978 }, { title: 'Halloween', release_date: '1978-10-25' });
  const other = scoreTmdbResult({ title: 'Halloween', releaseYear: 1978 }, { title: 'Halloween', release_date: '2018-10-19' });
  assert.ok(same > other);
});

test('matchLevel needs both strong AI confidence and strong verification for high', () => {
  assert.strictEqual(matchLevel('high', 0.95), 'high');
  assert.strictEqual(matchLevel('low', 0.95), 'low');
  assert.strictEqual(matchLevel('medium', 0.95), 'possible');
  assert.strictEqual(matchLevel('high', 0.2), 'none');
});

test('normalizeTrack builds links only from real ids', () => {
  const t = normalizeTrack({ title: 'X', artists: [{ name: 'Y' }], external_metadata: { spotify: { track: { id: 'abc' } } } });
  assert.deepStrictEqual(t.links, [{ label: 'Spotify', url: 'https://open.spotify.com/track/abc' }]);
});
