const gemini = require('./gemini.service');
const tmdb = require('./tmdb.service');
const acr = require('./acrcloud.service');
const { prepareFrames } = require('./frame.service');
const { matchLevel, CONF_WEIGHT } = require('../utils/matching');

async function identifyMovie({ frames }) {
  const prepared = prepareFrames(frames);
  const ai = await gemini.identifyScene(prepared);

  if (!ai.candidates.length) {
    return { status: 'no_match', matches: [], message: 'MedDet could not find enough evidence to name this scene. Try again on a moment with clearer faces or a wider shot.' };
  }

  // Verify every AI candidate against TMDB, then rank by evidence.
  const verified = [];
  const seen = new Set();
  for (const c of ai.candidates.slice(0, 3)) {
    const v = await tmdb.verifyCandidate(c);
    if (!v) continue;
    const key = `${v.type}:${v.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verified.push({ cand: c, v, rank: v.score * 0.6 + (CONF_WEIGHT[c.confidence] ?? 0.3) * 0.4 });
  }
  verified.sort((a, b) => b.rank - a.rank);

  const matches = [];
  for (const { cand, v } of verified) {
    const level = matchLevel(cand.confidence, v.score);
    if (level === 'none') continue;
    const details = await tmdb.getDetails(v.type, v.id);
    matches.push({ ...details, matchLevel: level, evidence: cand.evidence });
  }

  if (!matches.length) {
    return { status: 'no_match', matches: [], message: 'MedDet had a guess, but it could not be verified in the movie database, so it is not shown.' };
  }
  const best = matches[0];
  const status = best.matchLevel === 'high' && (matches.length === 1 || matches[1].matchLevel !== 'high') ? 'completed' : 'multiple_candidates';
  return { status, matches };
}

async function identifyMusic({ audio, mimeType }) {
  const result = await acr.identifyAudio(Buffer.from(audio, 'base64'), mimeType);
  if (!result.found) {
    return { status: 'no_match', track: null, message: 'No song was recognised. Try again while the music is clearly audible, without speech over it.' };
  }
  return { status: 'completed', track: result.track };
}

module.exports = { identifyMovie, identifyMusic };
