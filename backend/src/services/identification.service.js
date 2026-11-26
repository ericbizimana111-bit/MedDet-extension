const crypto = require('crypto');
const gemini = require('./gemini.service');
const tmdb = require('./tmdb.service');
const acr = require('./acrcloud.service');
const musicArtwork = require('./musicArtwork.service');
const { prepareFrames } = require('./frame.service');
const { matchLevel } = require('../utils/matching');
const AppError = require('../utils/AppError');

const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 1000;
const analysisSessions = new Map();

function pruneSessions() {
  const now = Date.now();
  for (const [id, session] of analysisSessions) {
    if (session.expiresAt <= now) analysisSessions.delete(id);
  }
  while (analysisSessions.size >= MAX_SESSIONS) {
    analysisSessions.delete(analysisSessions.keys().next().value);
  }
}

function createSession(candidates, frames) {
  pruneSessions();
  const sessionId = crypto.randomBytes(32).toString('base64url');
  analysisSessions.set(sessionId, {
    candidates,
    frameHashes: new Set(frames.map((frame) => frame.hash)),
    attempts: 1,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sessionId;
}

function getSession(sessionId) {
  const session = analysisSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    analysisSessions.delete(sessionId);
    throw new AppError(410, 'SESSION_EXPIRED', 'This additional-analysis session has expired. Start a new identification.');
  }
  if (session.attempts >= 2) {
    throw new AppError(409, 'SESSION_COMPLETE', 'This session has already used its two analysis attempts.');
  }
  return session;
}

function evidenceQuality(candidate) {
  const count = new Set(candidate.evidence.map((entry) => entry.trim().toLowerCase()).filter(Boolean)).size;
  return count >= 2 ? 'multiple_clues' : 'limited_clues';
}

function catalogMatchQuality(verification) {
  if (verification.titleMatch === 'partial') return 'partial_title';
  if (verification.yearMatch === 'same') return 'exact_title_and_year';
  if (verification.yearMatch === 'within_one_year') return 'exact_title_year_close';
  if (verification.yearMatch === 'different') return 'exact_title_year_mismatch';
  return 'exact_title_year_unknown';
}

async function rankCandidates(candidates, { signal, deadlineAt }) {
  const candidateMatch = (candidate, level = candidate.confidence === 'low' ? 'low' : 'possible') => ({
    title: candidate.title,
    releaseYear: candidate.releaseYear,
    mediaType: candidate.mediaType,
    matchLevel: level,
    modelConfidence: candidate.confidence,
    evidenceQuality: evidenceQuality(candidate),
    actorsOrCharacters: candidate.actorsOrCharacters,
    sceneDescription: candidate.sceneDescription || '',
    evidence: candidate.evidence,
    timestamps: candidate.timestamps,
    metadataUnavailable: true,
  });
  const checked = await Promise.all(candidates.slice(0, 3).map(async (candidate) => {
    try {
      return { candidate, verification: await tmdb.verifyCandidate(candidate, { signal, deadlineAt }) };
    } catch (error) {
      if (signal?.aborted && signal.reason?.code === 'ABORT_ERR') throw error;
      console.warn('[tmdb] optional candidate verification failed', error.code || 'upstream error');
      return { candidate, error };
    }
  }));
  const unique = new Map();
  for (const item of checked.filter((entry) => entry.verification)) {
    const key = `${item.verification.type}:${item.verification.id}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  const levelOrder = { high: 3, possible: 2, low: 1 };
  const ranked = [...unique.values()].map(({ candidate, verification }) => ({
    candidate,
    verification,
    level: matchLevel(candidate, verification),
  })).filter((item) => item.level !== 'none')
    .sort((a, b) => (levelOrder[b.level] - levelOrder[a.level])
      || (b.verification.score - a.verification.score)
      || (b.candidate.evidence.length - a.candidate.evidence.length));

  let metadataUnavailable = checked.some((entry) => entry.error);
  const matches = await Promise.all(ranked.map(async ({ candidate, verification, level }) => {
    try {
      const details = await tmdb.getDetails(verification.type, verification.id, { signal, deadlineAt });
      return {
        ...details,
        matchLevel: level,
        modelConfidence: candidate.confidence,
        evidenceQuality: evidenceQuality(candidate),
        catalogMatchQuality: catalogMatchQuality(verification),
        actorsOrCharacters: candidate.actorsOrCharacters,
        sceneDescription: candidate.sceneDescription || '',
        evidence: candidate.evidence,
        timestamps: candidate.timestamps,
      };
    } catch (error) {
      if (signal?.aborted && signal.reason?.code === 'ABORT_ERR') throw error;
      metadataUnavailable = true;
      console.warn('[tmdb] optional detail lookup failed', error.code || 'upstream error');
      return candidateMatch(candidate, level);
    }
  }));

  for (const { candidate, error } of checked) {
    if (error) matches.push(candidateMatch(candidate));
  }
  return { matches, metadataUnavailable };
}

function insufficientEvidence(candidates, uncertaintyReason, sessionId) {
  return {
    status: 'insufficient_evidence',
    matches: [],
    candidates,
    uncertaintyReason: uncertaintyReason || 'The available frames do not contain enough distinct visual clues.',
    message: 'MedDet needs more visual evidence before it can verify a production.',
    ...(sessionId ? { sessionId } : {}),
  };
}

async function identifyInitial({ frames, platform, videoContext, signal, deadlineAt }) {
  const prepared = prepareFrames(frames);
  const ai = await gemini.identifyScene(prepared, { platform, videoContext, signal, deadlineAt });

  if (ai.requiresMoreEvidence) {
    const sessionId = createSession(ai.candidates, prepared);
    return insufficientEvidence(ai.candidates, ai.uncertaintyReason, sessionId);
  }
  if (!ai.candidates.length) {
    return {
      status: 'no_match',
      matches: [],
      uncertaintyReason: ai.uncertaintyReason,
      message: 'The available frames were analyzed, but they did not support a credible movie or TV match.',
    };
  }

  const ranked = await rankCandidates(ai.candidates, { signal, deadlineAt });
  const { matches, metadataUnavailable } = ranked;
  if (!matches.length) {
    return {
      status: 'no_match',
      matches: [],
      candidates: ai.candidates,
      uncertaintyReason: ai.uncertaintyReason,
      message: 'MedDet found possible titles, but none could be verified reliably in the movie database.',
    };
  }

  const hasSingleStrongMatch = matches[0].matchLevel === 'high'
    && matches.filter((match) => match.matchLevel === 'high').length === 1
    && !metadataUnavailable;
  if (hasSingleStrongMatch) return { status: 'completed', matches, candidates: ai.candidates };

  const sessionId = createSession(ai.candidates, prepared);
  return {
    status: 'possible_match',
    matches,
    candidates: ai.candidates,
    uncertaintyReason: ai.uncertaintyReason || 'Additional frames may help distinguish this candidate from alternatives.',
    message: metadataUnavailable
      ? 'TMDB metadata is temporarily unavailable; the AI identification is shown without catalog verification.'
      : matches.length > 1
        ? 'Multiple possible productions detected in this video.'
        : 'MedDet found a possible match, but the available visual evidence is not strong enough to confirm it.',
    ...(metadataUnavailable ? { metadataUnavailable: true } : {}),
    sessionId,
  };
}

async function identifyAdditional({ frames, priorFrames, sessionId, platform, videoContext, signal, deadlineAt }) {
  const session = getSession(sessionId);
  const prior = prepareFrames(priorFrames);
  if (prior.some((frame) => !session.frameHashes.has(frame.hash))) {
    throw new AppError(400, 'SESSION_FRAME_MISMATCH', 'The prior frames do not match this analysis session.');
  }
  const additional = prepareFrames(frames);
  session.attempts = 2;

  const priorHashes = new Set(prior.map((frame) => frame.hash));
  const fresh = additional.filter((frame) => !session.frameHashes.has(frame.hash) && !priorHashes.has(frame.hash));
  if (!fresh.length) {
    return insufficientEvidence(
      session.candidates,
      'No distinct new frames were available. Let the video play or move to another moment.',
      undefined
    );
  }

  const combined = [...prior, ...fresh]
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    .slice(0, 12);
  const ai = await gemini.identifyScene(combined, {
    priorCandidates: session.candidates,
    platform,
    videoContext,
    signal,
    deadlineAt,
  });

  if (ai.requiresMoreEvidence) {
    return insufficientEvidence(ai.candidates.length ? ai.candidates : session.candidates, ai.uncertaintyReason);
  }
  if (!ai.candidates.length) {
    return {
      status: 'no_match',
      matches: [],
      candidates: [],
      uncertaintyReason: ai.uncertaintyReason,
      message: 'The additional frames were analyzed, but they did not support a credible movie or TV match.',
    };
  }

  const ranked = await rankCandidates(ai.candidates, { signal, deadlineAt });
  const { matches, metadataUnavailable } = ranked;
  if (!matches.length) {
    return {
      status: 'no_match',
      matches: [],
      candidates: ai.candidates,
      uncertaintyReason: ai.uncertaintyReason,
      message: 'The additional analysis produced possible titles, but none could be verified reliably in the movie database.',
    };
  }
  const hasSingleStrongMatch = matches[0].matchLevel === 'high'
    && matches.filter((match) => match.matchLevel === 'high').length === 1
    && !metadataUnavailable;
  const message = metadataUnavailable
    ? 'TMDB metadata is temporarily unavailable; the AI identification is shown without catalog verification.'
    : matches.length > 1
      ? 'Multiple possible productions detected in this video.'
      : hasSingleStrongMatch
        ? null
        : 'This remains a possible match; the available evidence does not justify a confirmed identification.';
  return {
    status: hasSingleStrongMatch ? 'completed' : 'possible_match',
    matches,
    candidates: ai.candidates,
    ...(metadataUnavailable ? { metadataUnavailable: true } : {}),
    ...(message ? { message } : {}),
    ...(hasSingleStrongMatch ? {} : {
      uncertaintyReason: ai.uncertaintyReason || 'The additional frames did not provide enough independent clues for a strong match.',
    }),
  };
}

async function identifyMovie(request) {
  if (request.pass === 'additional') return identifyAdditional(request);
  return identifyInitial(request);
}

async function identifyMusic({ audio, mimeType }) {
  const result = await acr.identifyAudio(Buffer.from(audio, 'base64'), mimeType);
  if (!result.found) {
    return { status: 'no_match', track: null, message: 'No song was recognised. Try again while the music is clearly audible, without speech over it.' };
  }
  const artwork = await musicArtwork.findArtwork(result.track);
  const releaseYear = result.track.releaseYear || artwork?.artworkReleaseYear || null;
  return {
    status: 'completed',
    track: {
      ...result.track,
      releaseYear,
      genre: result.track.genre || artwork?.artworkGenre || null,
      artworkAlbum: artwork?.artworkAlbum || null,
      artworkUrl: artwork?.artworkUrl || null,
      artworkProvider: artwork?.artworkProvider || null,
      artworkType: artwork?.artworkType || null,
      artworkReleaseYear: artwork?.artworkReleaseYear || null,
      artworkGenre: artwork?.artworkGenre || null,
      artworkLink: artwork?.artworkLink || null,
    },
  };
}

module.exports = { identifyMovie, identifyMusic };
