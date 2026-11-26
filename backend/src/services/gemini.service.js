
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
  timestamps: z.array(z.number().finite().min(0).max(86400)).max(12),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();

const resultSchema = z.object({
  candidates: z.array(candidateSchema).max(3),
  requiresMoreEvidence: z.boolean(),
  uncertaintyReason: z.string().max(300),
}).strict();

const responseJsonSchema = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          releaseYear: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
          evidence: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
          actorsOrCharacters: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          sceneDescription: { type: 'string' },
          timestamps: { type: 'array', items: { type: 'number' }, maxItems: 12 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'releaseYear', 'mediaType', 'evidence', 'actorsOrCharacters', 'sceneDescription', 'timestamps', 'confidence'],
        additionalProperties: false,
      },
    },
    requiresMoreEvidence: { type: 'boolean' },
    uncertaintyReason: { type: 'string' },
  },
  required: ['candidates', 'requiresMoreEvidence', 'uncertaintyReason'],
  additionalProperties: false,
};

const responseSchema = z.object({
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() })).optional(),
    }).optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

const PROMPT = `You identify films and television productions from a set of time-ordered video frames.
Analyze the frames as a time-ordered video. Determine whether they show one production or cuts between multiple productions, as in fan edits and compilations. Do not force unrelated footage into one scene.
Consider recognizable actors or animated characters, appearance, clothing and costumes, locations, environments, buildings and sets, props, visible dialogue subtitles, on-screen text, distinctive events, cinematography and continuity across frames.
Treat subtitles only as supporting context, never as proof of the title. Do not rely on creator captions, social overlays or watermarks.
Ignore TikTok, Instagram and YouTube interface elements, watermarks, reaction-video hosts, commentary, edits and unrelated creator captions. Distinguish original production footage from commentary, reaction videos or fan edits when the frames support that distinction.
Do not invent titles, actors, characters, scenes or events. Do not state actor or character identities unless the visual evidence supports them. Treat conflicting clues as uncertainty.
Return a candidate only when specific visual evidence supports it. Distinguish a movie from a TV production. Return candidates best-first, at most three, and include separate candidates for distinct productions when the footage supports them. Include the input frame timestamps where each production is visible; never invent or estimate timestamps.
For every candidate, provide separate visible clues, named actors or characters only when confidently recognizable, a concise scene description and timestamps. High confidence requires multiple independent visual clues that agree across the frames; this is model-reported confidence, not proof.
Set requiresMoreEvidence=true when clearer or additional frames could reasonably resolve uncertainty. Set it false when the analyzed evidence is sufficient to conclude that no credible production match can be made. Explain uncertainty briefly when relevant.
If prior candidates are supplied, reassess them against all frames, including new evidence. Do not anchor on them; retain, revise or reject each candidate based on the combined evidence.
Respond with JSON only, exactly in this shape:
{"candidates":[{"title":string,"releaseYear":number|null,"mediaType":"movie"|"tv","evidence":[string],"actorsOrCharacters":[string],"sceneDescription":string,"timestamps":[number],"confidence":"high"|"medium"|"low"}],"requiresMoreEvidence":boolean,"uncertaintyReason":string}`;

function parseGeminiResponse(body) {
  if (typeof body !== 'string' || !body.trim()) {
    throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The analysis service returned an empty response.');
  }
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

  if (parsedEnvelope.data.promptFeedback?.blockReason) {
    throw new AppError(502, 'AI_BLOCKED', 'The analysis service could not process this visual content.');
  }
  if (!parsedEnvelope.data.candidates) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid response.');
  }
  if (!parsedEnvelope.data.candidates.length) {
    throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The analysis service returned no candidates.');
  }

  const candidate = parsedEnvelope.data.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(candidate.finishReason)) {
      throw new AppError(502, 'AI_BLOCKED', 'The analysis service could not process this visual content.');
    }
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service did not complete its response.');
  }
  if (!candidate.content?.parts) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid response.');
  }
  const text = candidate.content.parts
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) {
    throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The analysis service returned an empty response.');
  }

  let json;
  try {
    json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim());
  } catch {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned invalid JSON.');
  }

  const parsedResult = resultSchema.safeParse(json);
  if (!parsedResult.success) {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid result.');
  }
  return parsedResult.data;
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
]);
const MAX_RETRIES = 2;
const MAX_ATTEMPT_WINDOW_MS = 42_000;

function retryDelay(retryNumber) {
  return (200 * (2 ** (retryNumber - 1))) + Math.floor(Math.random() * 100);
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason || Object.assign(new Error('Request cancelled'), { code: 'ABORT_ERR' }));
    };
    if (signal?.aborted) return onAbort();
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
      text: `Frame ${i + 1}${f.timestamp != null ? ` (video time ${f.timestamp}s)` : ''}:`,
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
      responseJsonSchema,
    },
  });
  const operationDeadlineAt = Math.min(deadlineAt || (Date.now() + MAX_ATTEMPT_WINDOW_MS), Date.now() + MAX_ATTEMPT_WINDOW_MS);
  const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.gemini.apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
      body: payload,
      timeoutMs: 40_000,
      signal,
      maxResponseBytes: 2_000_000,
  };
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const remainingMs = operationDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      lastError = Object.assign(new Error('Gemini request deadline exceeded'), { code: 'ETIMEDOUT' });
      break;
    }
    response = undefined;
    try {
      response = await httpsRequest.requestHttps(url, {
        ...requestOptions,
        totalTimeoutMs: Math.min(MAX_ATTEMPT_WINDOW_MS, remainingMs),
      });
      if (![502, 503, 504].includes(response.status) || attempt === MAX_RETRIES) break;
      console.warn('[gemini] retrying transient upstream response', response.status, attempt + 1);
    } catch (error) {
      lastError = error;
      const requestAborted = signal?.aborted || ['REQUEST_DEADLINE', 'ABORT_ERR', 'ERESPONSETOOLARGE'].includes(error.code);
      const retryable = RETRYABLE_NETWORK_CODES.has(error.code);
      if (requestAborted || !retryable || attempt === MAX_RETRIES) break;
      console.warn('[gemini] retrying transient network failure', error.code || 'network error', attempt + 1);
    }
    if (attempt < MAX_RETRIES) {
      try {
        await waitForRetry(retryDelay(attempt + 1), signal);
      } catch (error) {
        lastError = error;
        break;
      }
    }
  }

  if (!response) {
    const error = lastError || new Error('Gemini request failed');
    if (signal?.aborted && signal.reason?.code === 'REQUEST_DEADLINE') {
      throw new AppError(504, 'REQUEST_TIMEOUT', 'The complete identification request exceeded its time limit.');
    }
    if ((signal?.aborted && signal.reason?.code === 'ABORT_ERR') || error.code === 'ABORT_ERR') {
      throw new AppError(499, 'REQUEST_CANCELLED', 'The identification request was cancelled.');
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'REQUEST_DEADLINE') {
      throw new AppError(504, 'AI_TIMEOUT', 'The analysis request timed out. Please try again.');
    }
    if (error.code !== 'ERESPONSETOOLARGE') console.error('[gemini] Request failed:', error.code || 'network error');
    throw new AppError(502, 'AI_UNAVAILABLE', 'The analysis service is unavailable right now.');
  }

  if (response.status === 429) {
    throw new AppError(
      503,
      'AI_QUOTA',
      'The analysis service is busy right now. Please try again shortly.'
    );
  }

  if ([400, 401, 403].includes(response.status)) {
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
      'Gemini is temporarily unavailable. Please try again shortly.'
    );
  }

  if (response.status === 504) {
    throw new AppError(504, 'AI_TIMEOUT', 'The analysis request timed out. Please try again.');
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
    const result = parseGeminiResponse(response.body);
    const availableTimestamps = new Set(
      frames.filter((frame) => Number.isFinite(frame.timestamp)).map((frame) => frame.timestamp)
    );
    if (result.candidates.some((candidate) => (
      candidate.timestamps.some((timestamp) => !availableTimestamps.has(timestamp))
    ))) {
      throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned unsupported frame timestamps.');
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'The analysis service returned an invalid response.');
  }
}

module.exports = { identifyScene, parseGeminiResponse };
