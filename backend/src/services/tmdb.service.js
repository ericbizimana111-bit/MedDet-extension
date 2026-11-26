const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const { compareTmdbResult } = require('../utils/matching');
const httpsRequest = require('../utils/httpsRequest');

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const IMAGE_PATH = /^\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;

function tmdbImage(path, size) {
  if (typeof path !== 'string' || !IMAGE_PATH.test(path)) return null;
  return `${IMG}/${size}/${encodeURIComponent(path.slice(1))}`;
}

async function tmdb(path, params = {}, { signal, deadlineAt } = {}) {
  if (!env.tmdb.apiKey) throw new AppError(503, 'TMDB_NOT_CONFIGURED', 'Movie lookup is not configured on the server (missing TMDB_API_KEY).');
  const qs = new URLSearchParams({ api_key: env.tmdb.apiKey, language: 'en-US', ...params });
  let res;
  const remainingMs = deadlineAt ? Math.min(10_000, deadlineAt - Date.now()) : 10_000;
  if (remainingMs <= 0) throw new AppError(504, 'REQUEST_TIMEOUT', 'The complete identification request exceeded its time limit.');
  try {
    res = await httpsRequest.requestHttps(`${BASE}${path}?${qs}`, {
      timeoutMs: remainingMs,
      totalTimeoutMs: remainingMs,
      signal,
      maxResponseBytes: 2_000_000,
    });
  } catch (error) {
    if (signal?.aborted && signal.reason?.code === 'REQUEST_DEADLINE') {
      throw new AppError(504, 'REQUEST_TIMEOUT', 'The complete identification request exceeded its time limit.');
    }
    if (signal?.aborted && signal.reason?.code === 'ABORT_ERR') {
      throw new AppError(499, 'REQUEST_CANCELLED', 'The identification request was cancelled.');
    }
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
async function verifyCandidate(candidate, { signal, deadlineAt } = {}) {
  const type = candidate.mediaType === 'tv' ? 'tv' : 'movie';
  const params = { query: candidate.title, include_adult: 'false' };
  if (candidate.releaseYear) params[type === 'tv' ? 'first_air_date_year' : 'year'] = String(candidate.releaseYear);

  let data = await tmdb(`/search/${type}`, params, { signal, deadlineAt });
  const scoreResults = (results) => (results || []).slice(0, 8)
    .map((result) => ({ result, ...compareTmdbResult(candidate, result) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  let scored = scoreResults(data.results);

  if (!scored.length && candidate.releaseYear) {
    delete params.year; delete params.first_air_date_year;
    data = await tmdb(`/search/${type}`, params, { signal, deadlineAt });
    scored = scoreResults(data.results);
  }

  if (!scored.length) {
    const alternatives = await Promise.all((data.results || []).slice(0, 2).map(async (result) => {
      const altData = await tmdb(`/${type}/${result.id}/alternative_titles`, {}, { signal, deadlineAt });
      const titles = type === 'movie'
        ? (altData.titles || []).map((entry) => entry.title)
        : (altData.results || []).map((entry) => entry.name);
      return titles.map((title) => ({
        title,
        ...compareTmdbResult(candidate, {
          ...result,
          original_title: title,
          original_name: title,
        }),
      })).sort((a, b) => b.score - a.score)[0];
    }));
    const bestAltIndex = alternatives.findIndex((match) => match?.score > 0);
    if (bestAltIndex >= 0) {
      const result = data.results[bestAltIndex];
      return {
        type,
        id: result.id,
        score: alternatives[bestAltIndex].score,
        titleMatch: alternatives[bestAltIndex].titleMatch,
        yearMatch: alternatives[bestAltIndex].yearMatch,
        matchedByAlternativeTitle: true,
      };
    }
  }
  const best = scored[0];
  return best ? {
    type,
    id: best.result.id,
    score: best.score,
    titleMatch: best.titleMatch,
    yearMatch: best.yearMatch,
    matchedByAlternativeTitle: false,
  } : null;
}

async function getDetails(type, id, { signal, deadlineAt } = {}) {
  const d = await tmdb(`/${type}/${id}`, { append_to_response: 'credits' }, { signal, deadlineAt });
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
    poster: tmdbImage(d.poster_path, 'w342'),
    backdrop: tmdbImage(d.backdrop_path, 'w780'),
    genres: (d.genres || []).map((g) => g.name),
    runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
    seasons: type === 'tv' ? d.number_of_seasons || null : null,
    director,
    cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    tmdbUrl: `https://www.themoviedb.org/${type}/${d.id}`,
  };
}

module.exports = { verifyCandidate, getDetails, tmdbImage };
