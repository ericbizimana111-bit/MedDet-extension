const svc = require('../services/identification.service');

const movie = async (req, res, next) => {
  try {
    const data = await svc.identifyMovie({ ...req.body, ...req.identificationContext });
    res.json({ success: true, data: { type: 'movie', ...data } });
  } catch (e) { next(e); }
};

const music = async (req, res, next) => {
  try {
    const data = await svc.identifyMusic(req.body);
    res.json({ success: true, data: { type: 'music', ...data } });
  } catch (e) { next(e); }
};

module.exports = { movie, music };
