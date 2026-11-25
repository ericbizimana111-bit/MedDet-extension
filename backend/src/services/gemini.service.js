const { z } = require('zod');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');

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

async function identifyScene(frames) {
  if (!env.gemini.apiKey) throw new AppError(503, 'GEMINI_NOT_CONFIGURED', 'Movie identification is not configured on the server (missing GEMINI_API_KEY).');

  const parts = [{ text: PROMPT }];
  frames.forEach((f, i) => {
    parts.push({ text: `Frame ${i + 1}${f.timestamp != null ? ` (video time ${f.timestamp.toFixed(1)}s)` : ''}:` });
    parts.push({ inlineData: { mimeType: f.mimeType || 'image/jpeg', data: f.image } });
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.gemini.model)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.gemini.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (e) {
    throw new AppError(504, 'AI_TIMEOUT', 'The analysis took too long. Please try again.');
  }

  if (res.status === 429) throw new AppError(503, 'AI_QUOTA', 'The analysis service is busy right now. Please try again shortly.');
  if (res.status === 400 || res.status === 403) {
    const body = await res.text().catch(() => '');
    console.error('[gemini]', res.status, body.slice(0, 300));
    throw new AppError(502, 'AI_REJECTED', 'The analysis service rejected the request (check GEMINI_API_KEY and GEMINI_MODEL).');
  }
  if (!res.ok) throw new AppError(502, 'AI_UNAVAILABLE', 'The analysis service is unavailable right now.');

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let json;
  try {
    json = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    // Unparseable output is treated as "no usable answer", never invented.
    return { candidates: [], requiresMoreEvidence: true };
  }
  const parsed = resultSchema.safeParse(json);
  if (!parsed.success) return { candidates: [], requiresMoreEvidence: true };
  return parsed.data;
}

module.exports = { identifyScene };
