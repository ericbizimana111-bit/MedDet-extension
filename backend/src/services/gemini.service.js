
const { z } = require('zod');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const httpsRequest = require('../utils/httpsRequest');

const candidateSchema = z.object({
  title: z.string().min(1).max(200),
  releaseYear: z.number().int().min(1888).max(2100).nullish(),
  mediaType: z.enum(['movie', 'tv']).default('movie'),
  evidence: z.array(z.string().max(300)).max(6).default([]),
  confidence: z.enum(['high', 'medium', 'low']).default('low'),
});

const resultSchema = z.object({
  candidates: z.array(candidateSchema).max(5).default([]),
  requiresMoreEvidence: z.boolean().default(false),
});

const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() })),
    }),
  })).min(1),
});

const PROMPT = `You are the scene-recognition engine of a movie and TV identification tool.
You receive several frames taken from ONE short video clip, in time order.
Task: decide which movie or TV show the clip comes from.
Rules:
- Use visual evidence only: recognisable actors/characters, costumes, sets, locations, props, on-screen subtitles or text, cinematography.
- The clip may be cropped, vertical, filtered, watermarked or have caption overlays. Ignore social-media UI and watermarks.
- Do NOT guess. If the evidence is not enough to name a specific title, return an empty candidates list and requiresMoreEvidence=true.
- Return at most 3 candidates, best first. Set confidence to "high" only if several independent clues agree.
- Evidence entries must describe what you actually see in the frames.
Respond with JSON only, exactly in this shape:
{"candidates":[{"title":string,"releaseYear":number|null,"mediaType":"movie"|"tv","evidence":[string],"confidence":"high"|"medium"|"low"}],"requiresMoreEvidence":boolean}`;

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
  if (!text) return { candidates: [], requiresMoreEvidence: true };

  let json;
  try {
    json = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { candidates: [], requiresMoreEvidence: true };
  }

  const parsedResult = resultSchema.safeParse(json);
  return parsedResult.success
    ? parsedResult.data
    : { candidates: [], requiresMoreEvidence: true };
}

async function identifyScene(frames) {
  if (!env.gemini.apiKey) {
    throw new AppError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Movie identification is not configured on the server (missing GEMINI_API_KEY).'
    );
  }

  const parts = [{ text: PROMPT }];

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
      maxResponseBytes: 2_000_000,
    });
  } catch (error) {
    if (error.code !== 'ERESPONSETOOLARGE') {
      console.error('[gemini] Request failed:', error.code || 'network error');
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
