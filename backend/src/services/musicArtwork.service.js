const httpsRequest = require('../utils/httpsRequest');

const BASE = 'https://itunes.apple.com/search';
const CACHE_TTL_MS = 6 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();

function normalize(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function imageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
        || !/^[a-z0-9-]+\.mzstatic\.com$/i.test(url.hostname)
        || !/^\/image\/thumb\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)
        || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function releaseYear(value) {
  const year = Number.parseInt(String(value || '').slice(0, 4), 10);
  return Number.isInteger(year) && year >= 1888 && year <= 2100 ? year : null;
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key, value) {
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function matchResult(track, result) {
  if (!result || typeof result !== 'object') return null;
  if (result.kind !== 'song' || normalize(result.trackName) !== normalize(track.title)) return null;
  const trackArtists = (track.artists || []).map(normalize).filter(Boolean);
  const resultArtist = normalize(result.artistName);
  if (!trackArtists.length || !resultArtist) return null;
  const exactArtist = trackArtists.some((artist) => artist === resultArtist)
    || normalize(trackArtists.join(' and ')) === resultArtist;
  if (!exactArtist) return null;

  const artwork = imageUrl(result.artworkUrl100);
  if (!artwork) return null;

  const albumMatch = track.album && normalize(track.album) === normalize(result.collectionName);
  const matchScore = (albumMatch ? 4 : 0)
    + (track.releaseDate && releaseYear(result.releaseDate) === releaseYear(track.releaseDate) ? 2 : 0);
  const sameNamedCollection = normalize(result.collectionName) === normalize(result.trackName);
  return {
    artworkUrl: artwork,
    artworkProvider: 'iTunes',
    artworkType: albumMatch ? 'album' : sameNamedCollection ? 'single' : 'alternative_release',
    artworkAlbum: result.collectionName || null,
    artworkReleaseYear: releaseYear(result.releaseDate),
    artworkGenre: typeof result.primaryGenreName === 'string' ? result.primaryGenreName : null,
    artworkLink: typeof result.collectionViewUrl === 'string' ? result.collectionViewUrl : null,
    matchScore,
  };
}

async function findArtwork(track) {
  if (!track || typeof track.title !== 'string' || !track.title.trim()
      || !Array.isArray(track.artists) || !track.artists.some((artist) => typeof artist === 'string' && artist.trim())) {
    return null;
  }

  const cacheKey = JSON.stringify([
    normalize(track.title),
    track.artists.map(normalize).filter(Boolean),
    normalize(track.album || ''),
    releaseYear(track.releaseDate),
    track.isrc || '',
  ]);
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const term = [track.title, track.artists.filter(Boolean).join(' '), track.album]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ');
  const query = new URLSearchParams({ term, entity: 'song', limit: '15' });

  try {
    const response = await httpsRequest.requestHttps(`${BASE}?${query}`, {
      timeoutMs: 5_000,
      totalTimeoutMs: 5_000,
      maxResponseBytes: 500_000,
    });
    if (response.status < 200 || response.status >= 300) {
      console.warn('[music-artwork] Lookup returned HTTP', response.status);
      cacheSet(cacheKey, null);
      return null;
    }

    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      console.warn('[music-artwork] Lookup returned invalid JSON');
      cacheSet(cacheKey, null);
      return null;
    }
    if (!Array.isArray(data.results)) {
      console.warn('[music-artwork] Lookup response did not contain results');
      cacheSet(cacheKey, null);
      return null;
    }

    const matches = data.results
      .map((result) => matchResult(track, result))
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore);
    const { matchScore: _matchScore, ...artwork } = matches[0] || {};
    const value = matches.length ? artwork : null;
    cacheSet(cacheKey, value);
    return value;
  } catch (error) {
    console.warn('[music-artwork] Lookup unavailable:', error.code || 'network error');
    cacheSet(cacheKey, null);
    return null;
  }
}

module.exports = { findArtwork, imageUrl, matchResult, normalize };
