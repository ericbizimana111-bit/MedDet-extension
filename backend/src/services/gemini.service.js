
const { z } = require('zod');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const httpsRequest = require('../utils/httpsRequest');

const candidateSchema = z.object({
  title: z.string().min(1).max(200),
  releaseYear: z.number().int().min(1888).max(2100).nullable(),
  mediaType: z.enum(['movie', 'tv']),
  evidence: z.array(z.string().min(1).max(300)).min(1).max(6),
  actorsOrCharacters: z.array(z.string().min(1).max(120)).max(6),
  sceneDescription: z.string().max(500),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();

const resultSchema = z.object({
  candidates: z.array(candidateSchema).max(3),
  requiresMoreEvidence: z.boolean(),
  uncertaintyReason: z.string().max(300),
}).strict();

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() })),
    }),
  })).min(1),
});

const PROMPT = `You identify films and television productions from a set of time-ordered video frames.
Analyze the frames together as one scene; do not identify a title from a single generic visual resemblance.
Consider recognizable actors or animated characters, appearance, clothing and costumes, locations, environments, buildings and sets, props, visible dialogue subtitles, on-screen text, distinctive events, cinematography and continuity across frames.
Treat subtitles only as supporting context, never as proof of the title. Do not rely on creator captions, social overlays or watermarks.
Ignore TikTok, Instagram and YouTube interface elements, watermarks, reaction-video hosts, commentary, edits and unrelated creator captions. Distinguish original production footage from commentary, reaction videos or fan edits when the frames support that distinction.
Do not invent titles, actors, characters, scenes or events. Do not state actor or character identities unless the visual evidence supports them. Treat conflicting clues as uncertainty.
Return a candidate only when specific visual evidence supports it. Distinguish a movie from a TV production. Return candidates best-first, at most three, and only include alternatives when there is real ambiguity.
For every candidate, provide separate visible clues, named actors or characters only when confidently recognizable, and a concise scene description. High confidence requires multiple independent visual clues that agree across the frames; this is model-reported confidence, not proof.
Set requiresMoreEvidence=true when clearer or additional frames could reasonably resolve uncertainty. Set it false when the analyzed evidence is sufficient to conclude that no credible production match can be made. Explain uncertainty briefly when relevant.
If prior candidates are supplied, reassess them against all frames, including new evidence. Do not anchor on them; retain, revise or reject each candidate based on the combined evidence.
Respond with JSON only, exactly in this shape:
{"candidates":[{"title":string,"releaseYear":number|null,"mediaType":"movie"|"tv","evidence":[string],"actorsOrCharacters":[string],"sceneDescription":string,"confidence":"high"|"medium"|"low"}],"requiresMoreEvidence":boolean,"uncertaintyReason":string}`;

function parseGeminiResponse(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid response.');
  }

  const parsedEnvelope = responseSchema.safeParse(data);
  if (!parsedEnvelope.success) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid response.');
  }

  const text = parsedEnvelope.data.candidates[0].content.parts
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an empty response.');
  }

  let json;
  try {
    json = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned invalid JSON.');
  }

  const parsedResult = resultSchema.safeParse(json);
  if (!parsedResult.success) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid result.');
  }
  return parsedResult.data;
}

async function identifyScene(frames, { priorCandidates = [], platform, videoContext, signal, deadlineAt } = {}) {
  if (!env.gemini.apiKey) {
    throw new AppError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Movie identification is not configured on the server (missing GEMINI_API_KEY).'
    );
  }

  const parts = [{ text: PROMPT }];
  const clipMetadata = Object.fromEntries(Object.entries({
    platform,
    currentTime: videoContext?.currentTime,
    duration: videoContext?.duration,
    width: videoContext?.width,
    height: videoContext?.height,
  }).filter(([, value]) => value !== undefined));
  if (Object.keys(clipMetadata).length) {
    parts.push({ text: `Clip metadata (context only; do not infer a title from the platform): ${JSON.stringify(clipMetadata)}` });
  }
  if (priorCandidates.length) {
    parts.push({ text: `Prior unconfirmed candidates for reassessment (not trusted conclusions): ${JSON.stringify(priorCandidates)}` });
  }

  frames.forEach((f, i) => {
    parts.push({
      text: `Frame ${i + 1}${f.timestamp != null ? ` (video time ${f.timestamp.toFixed(1)}s)` : ''}:`,
    });

    parts.push({
      inlineData: {
        mimeType: f.mimeType || 'image/jpeg',
        data: f.image,
      },
    });
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.gemini.model)}:generateContent`;

  let response;
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });
  try {
    response = await httpsRequest.requestHttps(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.gemini.apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
      body: payload,
      timeoutMs: 40_000,
      totalTimeoutMs: Math.max(1, Math.min(42_000, deadlineAt ? deadlineAt - Date.now() : 42_000)),
      signal,
      maxResponseBytes: 2_000_000,
    });
  } catch (error) {
    if (error.code !== 'ERESPONSETOOLARGE') {
      console.error('[gemini] Request failed:', error.code || 'network error');
    }
    if (signal?.aborted && signal.reason?.code === 'REQUEST_DEADLINE') {
      throw new AppError(504, 'REQUEST_TIMEOUT', 'The complete identification request exceeded its time limit.');
    }
    if (signal?.aborted && signal.reason?.code === 'ABORT_ERR') {
      throw new AppError(499, 'REQUEST_CANCELLED', 'The identification request was cancelled.');
    }
    if (error.code === 'ETIMEDOUT') {
      throw new AppError(504, 'AI_TIMEOUT', 'The analysis service could not be reached. Please try again.');
    }
    throw new AppError(502, 'AI_UNAVAILABLE', 'The analysis service is unavailable right now.');
  }

  if (response.status === 429) {
    throw new AppError(
      503,
      'AI_QUOTA',
      'The analysis service is busy right now. Please try again shortly.'
    );
  }

  if (response.status === 400 || response.status === 403) {
    console.error('[gemini] Request rejected with HTTP', response.status);

    throw new AppError(
      502,
      'AI_REJECTED',
      'The analysis service rejected the request. Check GEMINI_API_KEY and GEMINI_MODEL.'
    );
  }

  if (response.status === 503) {
    console.error('[gemini] Service temporarily unavailable (HTTP 503)');

    throw new AppError(
      503,
      'AI_BUSY',
      'The analysis service is temporarily busy. Please try again shortly.'
    );
  }

  if (response.status < 200 || response.status >= 300) {
    console.error('[gemini] Upstream request failed with HTTP', response.status);

    throw new AppError(
      502,
      'AI_UNAVAILABLE',
      'The analysis service is unavailable right now.'
    );
  }

  try {
    return parseGeminiResponse(response.body);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid response.');
  }
}

module.exports = { identifyScene, parseGeminiResponse };
