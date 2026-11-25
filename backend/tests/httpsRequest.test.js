const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { requestHttps } = require('../src/utils/httpsRequest');

test('HTTPS helper selects IPv4, enforces timeout options, and returns bounded response bodies', async (t) => {
  const originalRequest = https.request;
  let captured;
  https.request = (url, options, callback) => {
    captured = { url, options };
    const request = new EventEmitter();
    request.write = (body) => { captured.body = body; };
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.from('ok'));
        response.emit('end');
      });
    };
    request.destroy = (error) => request.emit('error', error);
    return request;
  };
  t.after(() => { https.request = originalRequest; });

  const result = await requestHttps('https://example.test/path', {
    method: 'POST',
    body: 'payload',
    timeoutMs: 1234,
  });
  assert.equal(captured.options.family, 4);
  assert.equal(captured.options.timeout, 1234);
  assert.equal(captured.body, 'payload');
  assert.deepEqual(result, { status: 200, body: 'ok' });
});
