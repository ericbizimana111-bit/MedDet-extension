const https = require('node:https');

function requestHttps(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 10_000,
  maxResponseBytes = 2_000_000,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const req = https.request(url, {
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
    if (body !== undefined) req.write(body);
    req.end();
  });
}

module.exports = { requestHttps };
