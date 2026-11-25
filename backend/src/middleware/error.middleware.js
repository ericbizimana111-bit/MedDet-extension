const notFound = (_req, res) =>
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'The captured media was too large.' } });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err.code || '', err.message); // never log media or keys
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status >= 500 && !err.code ? 'Something went wrong on our side.' : err.message,
    },
  });
};

module.exports = { notFound, errorHandler };
