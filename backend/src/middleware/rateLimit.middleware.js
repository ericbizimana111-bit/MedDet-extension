const rateLimit = require('express-rate-limit');
const { env, serviceStatus } = require('../config/env');

const handler = (_req, res) =>
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'You have reached the free identification limit for now. Please try again later.' },
  });

const opts = (limit) => ({ windowMs: 3600_000, limit, standardHeaders: true, legacyHeaders: false, handler });
const movieLimiter = rateLimit(opts(env.limits.perHour));
const musicLimiter = rateLimit(opts(env.limits.musicPerHour));

// Global daily budget guard: protects against unexpected API bills.
let day = new Date().toISOString().slice(0, 10);
let count = 0;
function dailyBudget(service) {
  return (_req, res, next) => {
    if (!serviceStatus()[service]) return next();

    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; count = 0; }
    if (count >= env.limits.dailyGlobal) {
      return res.status(503).json({
        success: false,
        error: { code: 'DAILY_CAPACITY', message: 'MedDet has reached its free daily capacity. Please try again tomorrow.' },
      });
    }
    count += 1;
    next();
  };
}

module.exports = { movieLimiter, musicLimiter, dailyBudget };
