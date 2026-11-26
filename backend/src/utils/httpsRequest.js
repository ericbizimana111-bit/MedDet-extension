const https = require('node:https');

function requestHttps(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 10_000,
  totalTimeoutMs,
  signal,
  maxResponseBytes = 2_000_000,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let totalTimer;
    let onAbort;
    let req;
    const cleanup = () => {
      if (totalTimer) clearTimeout(totalTimer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const abortError = () => {
      const reason = signal?.reason;
      const error = new Error(reason?.message || 'Upstream request was cancelled');
      error.code = reason?.code || (reason?.name === 'TimeoutError' ? 'ETIMEDOUT' : 'ABORT_ERR');
      return error;
    };
    if (signal?.aborted) {
      finish(abortError());
      return;
    }

    req = https.request(url, {
      method,
      family: 4,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          const error = new Error('Upstream response exceeded the size limit');
          error.code = 'ERESPONSETOOLARGE';
          res.destroy(error);
          finish(error);
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => finish(null, {
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', (error) => finish(error));
    });

    req.on('timeout', () => {
      const error = new Error('Upstream request timed out');
      error.code = 'ETIMEDOUT';
      req.destroy(error);
    });
    req.on('error', (error) => finish(error));
    if (Number.isFinite(totalTimeoutMs) && totalTimeoutMs > 0) {
      totalTimer = setTimeout(() => {
        const error = new Error('Upstream request exceeded its total deadline');
        error.code = 'ETIMEDOUT';
        finish(error);
        req.destroy(error);
      }, totalTimeoutMs);
    }
    if (signal) {
      onAbort = () => {
        const error = abortError();
        finish(error);
        req.destroy(error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (body !== undefined) req.write(body);
    req.end();
  });
}

module.exports = { requestHttps };
