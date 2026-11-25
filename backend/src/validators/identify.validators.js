const { z } = require('zod');

const stripDataUrl = (s) => s.replace(/^data:[^;]+;base64,/, '');

const MAX_FRAME_B64 = 1_800_000; // ~1.3 MB per frame
const MAX_AUDIO_B64 = 1_500_000; // ~1.1 MB (12s mono 8kHz WAV is ~200 KB)

const platform = z.enum(['youtube', 'instagram', 'tiktok', 'facebook', 'other']).default('other');

function imageMimeType(b64) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const imageSchema = z.string().min(100).max(MAX_FRAME_B64 + 40).superRefine((input, ctx) => {
  const match = input.match(/^data:([^;,]+);base64,/i);
  const base64 = stripDataUrl(input);
  const actualMime = imageMimeType(base64);
  if (!actualMime) {
    ctx.addIssue({ code: 'custom', message: 'must contain valid JPEG, PNG, or WebP base64 image data' });
    return;
  }
  if (match && match[1].toLowerCase() !== actualMime) {
    ctx.addIssue({ code: 'custom', message: 'data URL MIME type does not match the image data' });
  }
}).transform(stripDataUrl);

const audioSchema = z.string().min(100).max(MAX_AUDIO_B64 + 40).superRefine((input, ctx) => {
  const match = input.match(/^data:([^;,]+);base64,/i);
  const base64 = stripDataUrl(input);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    ctx.addIssue({ code: 'custom', message: 'must contain valid base64 audio data' });
  }
  if (match && !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/webm', 'audio/ogg'].includes(match[1].toLowerCase())) {
    ctx.addIssue({ code: 'custom', message: 'data URL MIME type is not supported' });
  }
});

const movieSchema = z.object({
  frames: z
    .array(
      z.object({
        image: imageSchema,
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
        timestamp: z.number().min(0).max(86400).optional(),
      }).superRefine((frame, ctx) => {
        if (frame.mimeType && imageMimeType(frame.image) !== frame.mimeType) {
          ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'does not match the image data' });
        }
      })
    )
    .min(1)
    .max(6),
  platform,
  videoContext: z.object({ currentTime: z.number().optional() }).optional(),
});

const musicSchema = z.object({
  audio: audioSchema,
  mimeType: z.enum(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/webm', 'audio/ogg']).default('audio/wav'),
  platform,
}).superRefine((request, ctx) => {
  const match = request.audio.match(/^data:([^;,]+);base64,/i);
  if (match && match[1].toLowerCase() !== request.mimeType) {
    ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'does not match the audio data URL MIME type' });
  }
}).transform(({ audio, ...request }) => ({ ...request, audio: stripDataUrl(audio) }));

/** JPEG starts with /9j/ in base64, PNG with iVBOR, WEBP with UklG */
function looksLikeImage(b64) {
  return b64.startsWith('/9j/') || b64.startsWith('iVBOR') || b64.startsWith('UklG');
}

module.exports = { movieSchema, musicSchema, looksLikeImage };
