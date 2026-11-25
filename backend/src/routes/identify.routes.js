const router = require('express').Router();
const ctrl = require('../controllers/identify.controller');
const { validate } = require('../middleware/validation.middleware');
const { movieSchema, musicSchema } = require('../validators/identify.validators');
const { movieLimiter, musicLimiter, dailyBudget } = require('../middleware/rateLimit.middleware');

// Order matters: cheap checks first, paid services last.
router.post('/movie', movieLimiter, validate(movieSchema), dailyBudget('gemini'), ctrl.movie);
router.post('/music', musicLimiter, validate(musicSchema), dailyBudget('music'), ctrl.music);

module.exports = router;
