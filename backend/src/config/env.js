try { require('dotenv').config(); } catch { /* dotenv optional: real env vars still work */ }

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 5000),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  tmdb: { apiKey: process.env.TMDB_API_KEY || '' },
  acr: {
    host: process.env.ACRCLOUD_HOST || '',
    accessKey: process.env.ACRCLOUD_ACCESS_KEY || '',
    accessSecret: process.env.ACRCLOUD_ACCESS_SECRET || '',
  },
  limits: {
    perHour: int(process.env.RATE_LIMIT_PER_HOUR, 20),
    musicPerHour: int(process.env.RATE_LIMIT_MUSIC_PER_HOUR, 20),
    dailyGlobal: int(process.env.DAILY_GLOBAL_LIMIT, 1500),
  },
  corsExtraOrigins: (process.env.CORS_EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

/** Which services are usable right now. Never fake a missing one. */
function serviceStatus() {
  const acr = Boolean(env.acr.host && env.acr.accessKey && env.acr.accessSecret);
  return {
    movie: Boolean(env.gemini.apiKey && env.tmdb.apiKey),
    music: acr,
    gemini: Boolean(env.gemini.apiKey),
    tmdb: Boolean(env.tmdb.apiKey),
    acrcloud: acr,
  };
}

module.exports = { env, serviceStatus };
