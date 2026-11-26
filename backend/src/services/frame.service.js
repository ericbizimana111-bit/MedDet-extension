const crypto = require('crypto');
const { looksLikeImage } = require('../validators/identify.validators');
const AppError = require('../utils/AppError');

/** Validate image data, drop exact duplicates, keep time order. */
function prepareFrames(frames) {
  const seen = new Set();
  const out = [];
  for (const f of frames) {
    if (!looksLikeImage(f.image)) continue;
    const h = crypto.createHash('sha256').update(f.image).digest('hex');
    if (seen.has(h)) continue;
    seen.add(h);
    const mimeType = f.image.startsWith('iVBOR') ? 'image/png' : f.image.startsWith('UklG') ? 'image/webp' : 'image/jpeg';
    out.push({ image: f.image, timestamp: f.timestamp, mimeType, hash: h });
  }
  if (!out.length) throw new AppError(400, 'INVALID_INPUT', 'No valid image frames were received.');
  return out.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

module.exports = { prepareFrames };
