const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const { scoreTmdbResult } = require('../utils/matching');
const httpsRequest = require('../utils/httpsRequest');

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

async function tmdb(path, params = {}) {
  if (!env.tmdb.apiKey) throw new AppError(503, 'TMDB_NOT_CONFIGURED', 'Movie lookup is not configured on the server (missing TMDB_API_KEY).');
  const qs = new URLSearchParams({ api_key: env.tmdb.apiKey, language: 'en-US', ...params });
  let res;
  try {
    res = await httpsRequest.requestHttps(`${BASE}${path}?${qs}`, {
      timeoutMs: 10_000,
      maxResponseBytes: 2_000_000,
    });
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      throw new AppError(504, 'METADATA_TIMEOUT', 'The movie database took too long to respond.');
    }
    throw new AppError(502, 'METADATA_UNAVAILABLE', 'The movie database is unavailable right now.');
  }
  if (res.status === 401) throw new AppError(502, 'TMDB_REJECTED', 'The movie database rejected the server credentials.');
  if (res.status === 429) throw new AppError(503, 'METADATA_BUSY', 'The movie database is busy. Please try again shortly.');
  if (res.status < 200 || res.status >= 300) throw new AppError(502, 'METADATA_UNAVAILABLE', 'The movie database is unavailable right now.');
  try {
    return JSON.parse(res.body);
  } catch {
    throw new AppError(502, 'METADATA_INVALID_RESPONSE', 'The movie database returned an invalid response.');
  }
}

/** Search the right media type and return the best-scoring verified result (or null). */
async function verifyCandidate(candidate) {
  const type = candidate.mediaType === 'tv' ? 'tv' : 'movie';
  const params = { query: candidate.title, include_adult: 'false' };
  if (candidate.releaseYear) params[type === 'tv' ? 'first_air_date_year' : 'year'] = String(candidate.releaseYear);

  let data = await tmdb(`/search/${type}`, params);
  // The AI's year can be off by one; retry without the year filter.
  if (!data.results?.length && candidate.releaseYear) {
    delete params.year; delete params.first_air_date_year;
    data = await tmdb(`/search/${type}`, params);
  }
  let best = null;
  for (const r of (data.results || []).slice(0, 8)) {
    const score = scoreTmdbResult(candidate, r);
    if (score > 0 && (!best || score > best.score)) best = { result: r, score };
  }
  return best ? { type, id: best.result.id, score: best.score } : null;
}

async function getDetails(type, id) {
  const d = await tmdb(`/${type}/${id}`, { append_to_response: 'credits' });
  const crew = d.credits?.crew || [];
  const director = type === 'movie'
    ? crew.filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 2)
    : (d.created_by || []).map((c) => c.name).slice(0, 2);
  return {
    tmdbId: d.id,
    mediaType: type,
    title: d.title || d.name,
    releaseYear: parseInt(String(d.release_date || d.first_air_date || '').slice(0, 4), 10) || null,
    overview: d.overview || '',
    poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : null,
    genres: (d.genres || []).map((g) => g.name),
    runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
    seasons: type === 'tv' ? d.number_of_seasons || null : null,
    director,
    cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    tmdbUrl: `https://www.themoviedb.org/${type}/${d.id}`,
  };
}

module.exports = { verifyCandidate, getDetails };
