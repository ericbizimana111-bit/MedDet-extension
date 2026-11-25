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
function scoreTmdbResult(candidate, result) {
  const a = normalizeTitle(candidate.title);
  const names = [result.title, result.name, result.original_title, result.original_name]
    .filter(Boolean)
    .map(normalizeTitle);
  let titleScore = 0;
  if (names.includes(a)) titleScore = 1;
  else if (names.some((n) => n && (n.includes(a) || a.includes(n)) && Math.min(n.length, a.length) >= 4)) titleScore = 0.6;
  if (titleScore === 0) return 0;

  const ry = yearOf(result.release_date || result.first_air_date);
  let yearScore = 0.5; // unknown year: neutral
  if (candidate.releaseYear && ry) {
    const d = Math.abs(candidate.releaseYear - ry);
    yearScore = d === 0 ? 1 : d === 1 ? 0.7 : 0;
  }
  return titleScore * 0.7 + yearScore * 0.3;
}

const CONF_WEIGHT = { high: 1, medium: 0.6, low: 0.3 };

/** Evidence-based match level. Not a calibrated probability. */
function matchLevel(aiConfidence, verifyScore) {
  const w = CONF_WEIGHT[aiConfidence] ?? 0.3;
  if (verifyScore >= 0.85 && w === 1) return 'high';
  if (verifyScore >= 0.7 && w >= 0.6) return 'possible';
  if (verifyScore >= 0.6) return 'low';
  return 'none';
}

module.exports = { normalizeTitle, yearOf, scoreTmdbResult, matchLevel, CONF_WEIGHT };
