const TOTAL_REQUEST_MS = 55_000;

function movieRequestDeadline(req, res, next) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + TOTAL_REQUEST_MS;
  const timer = setTimeout(() => {
    const error = new Error('Identification exceeded its total deadline');
    error.code = 'REQUEST_DEADLINE';
    controller.abort(error);
  }, TOTAL_REQUEST_MS);

  const cleanup = () => clearTimeout(timer);
  req.identificationContext = { signal: controller.signal, deadlineAt };
  res.once('finish', cleanup);
  res.once('close', () => {
    if (!res.writableEnded) {
      const error = new Error('Client disconnected');
      error.code = 'ABORT_ERR';
      controller.abort(error);
    }
    cleanup();
  });
  next();
}

module.exports = { movieRequestDeadline, TOTAL_REQUEST_MS };
