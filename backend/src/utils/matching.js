// Pure helpers used to verify Gemini candidates against TMDB results.

function normalizeTitle(t = '') {
  return String(t)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function yearOf(dateStr) {
  const y = parseInt(String(dateStr || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/**
 * Score one TMDB result against one AI candidate (0..1).
 * Never "just take the first TMDB result".
 */
function compareTmdbResult(candidate, result) {
  const a = normalizeTitle(candidate.title);
  const names = [result.title, result.name, result.original_title, result.original_name]
    .filter(Boolean)
    .map(normalizeTitle);
  const exactTitle = names.includes(a);
  const partialTitle = !exactTitle && names.some((n) => n && (n.includes(a) || a.includes(n)) && Math.min(n.length, a.length) >= 4);
  const titleScore = exactTitle ? 1 : partialTitle ? 0.6 : 0;
  if (titleScore === 0) return { score: 0, titleMatch: 'none', yearMatch: 'unknown' };

  const ry = yearOf(result.release_date || result.first_air_date);
  let yearScore = 0.5; // unknown year: neutral
  let yearMatch = 'unknown';
  if (candidate.releaseYear && ry) {
    const d = Math.abs(candidate.releaseYear - ry);
    yearScore = d === 0 ? 1 : d === 1 ? 0.7 : 0;
    yearMatch = d === 0 ? 'same' : d === 1 ? 'within_one_year' : 'different';
  }
  return {
    score: titleScore * 0.7 + yearScore * 0.3,
    titleMatch: exactTitle ? 'exact' : 'partial',
    yearMatch,
  };
}

function scoreTmdbResult(candidate, result) {
  return compareTmdbResult(candidate, result).score;
}

/** A conservative presentation category, not a calibrated probability. */
function matchLevel(candidate, verification) {
  const evidenceCount = new Set(candidate.evidence.map((entry) => entry.trim().toLowerCase()).filter(Boolean)).size;
  if (candidate.confidence === 'high'
      && evidenceCount >= 2
      && verification.titleMatch === 'exact'
      && verification.yearMatch !== 'different') return 'high';
  if (verification.score >= 0.7 && candidate.confidence !== 'low') return 'possible';
  if (verification.score >= 0.6) return 'low';
  return 'none';
}

module.exports = { normalizeTitle, yearOf, compareTmdbResult, scoreTmdbResult, matchLevel };
