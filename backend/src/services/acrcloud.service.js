const crypto = require('crypto');
const { env } = require('../config/env');
const AppError = require('../utils/AppError');
const httpsRequest = require('../utils/httpsRequest');

function sign(timestamp) {
  const str = ['POST', '/v1/identify', env.acr.accessKey, 'audio', '1', timestamp].join('\n');
  return crypto.createHmac('sha1', env.acr.accessSecret).update(str).digest('base64');
}

/** Normalize an ACRCloud "music" item to MedDet's shape. */
function normalizeTrack(m) {
  const spotifyId = m.external_metadata?.spotify?.track?.id;
  const ytId = m.external_metadata?.youtube?.vid;
  const links = [];
  if (spotifyId) links.push({ label: 'Spotify', url: `https://open.spotify.com/track/${spotifyId}` });
  if (ytId) links.push({ label: 'YouTube', url: `https://www.youtube.com/watch?v=${ytId}` });
  return {
    title: m.title,
    artists: (m.artists || []).map((a) => a.name),
    album: m.album?.name || null,
    releaseDate: m.release_date || null,
    durationMs: m.duration_ms || null,
    links,
  };
}

async function identifyAudio(buffer, mimeType = 'audio/wav') {
  if (!env.acr.host || !env.acr.accessKey || !env.acr.accessSecret) {
    throw new AppError(503, 'ACR_NOT_CONFIGURED', 'Music identification is not configured on the server (missing ACRCLOUD_* settings).');
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const boundary = `----MedDet${crypto.randomBytes(16).toString('hex')}`;
  const fields = {
    access_key: env.acr.accessKey,
    sample_bytes: String(buffer.length),
    timestamp,
    signature: sign(timestamp),
    data_type: 'audio',
    signature_version: '1',
  };
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sample"; filename="sample"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  chunks.push(buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);

  let res;
  try {
    res = await httpsRequest.requestHttps(`https://${env.acr.host}/v1/identify`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
      timeoutMs: 20_000,
      maxResponseBytes: 2_000_000,
    });
  } catch (error) {
    if (error.code === 'ETIMEDOUT') {
      throw new AppError(504, 'MUSIC_TIMEOUT', 'The music service took too long to respond.');
    }
    throw new AppError(502, 'MUSIC_UNAVAILABLE', 'The music service is unavailable right now.');
  }
  if (res.status < 200 || res.status >= 300) throw new AppError(502, 'MUSIC_UNAVAILABLE', 'The music service is unavailable right now.');
  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new AppError(502, 'MUSIC_INVALID_RESPONSE', 'The music service returned an invalid response.');
  }
  const code = data?.status?.code;
  if (code === 0) {
    const m = data.metadata?.music?.[0];
    return m ? { found: true, track: normalizeTrack(m) } : { found: false };
  }
  if (code === 1001) return { found: false };               // no result
  if (code === 3001 || code === 3002 || code === 3003) throw new AppError(502, 'ACR_REJECTED', 'The music service rejected the server credentials or quota.');
  if (code === 2004 || code === 2005) return { found: false }; // unreadable / too short audio
  throw new AppError(502, 'MUSIC_FAILED', 'The music service could not process this sample.');
}

module.exports = { identifyAudio, normalizeTrack };
