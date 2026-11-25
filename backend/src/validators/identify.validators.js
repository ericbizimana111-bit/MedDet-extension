const { z } = require('zod');

const stripDataUrl = (s) => s.replace(/^data:[^;]+;base64,/, '');

const MAX_FRAME_B64 = 1_800_000; // ~1.3 MB per frame
const MAX_AUDIO_B64 = 1_500_000; // ~1.1 MB (12s mono 8kHz WAV is ~200 KB)

const platform = z.enum(['youtube', 'instagram', 'tiktok', 'facebook', 'other']).default('other');

const movieSchema = z.object({
  frames: z
    .array(
      z.object({
        image: z.string().min(100).max(MAX_FRAME_B64 + 40).transform(stripDataUrl),
        timestamp: z.number().min(0).max(86400).optional(),
      })
    )
    .min(1)
    .max(6),
  platform,
  videoContext: z.object({ currentTime: z.number().optional() }).optional(),
});

const musicSchema = z.object({
  audio: z.string().min(100).max(MAX_AUDIO_B64 + 40).transform(stripDataUrl),
  mimeType: z.enum(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/webm', 'audio/ogg']).default('audio/wav'),
  platform,
});

/** JPEG starts with /9j/ in base64, PNG with iVBOR, WEBP with UklG */
function looksLikeImage(b64) {
  return b64.startsWith('/9j/') || b64.startsWith('iVBOR') || b64.startsWith('UklG');
}

module.exports = { movieSchema, musicSchema, looksLikeImage };
