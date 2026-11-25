const AppError = require('../utils/AppError');

const validate = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return next(new AppError(400, 'INVALID_INPUT', `Invalid request: ${first.path.join('.') || 'body'} ${first.message}`));
  }
  req.body = parsed.data;
  next();
};

module.exports = { validate };
