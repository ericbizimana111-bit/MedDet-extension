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

test('HTTPS helper rejects an already-cancelled request without opening a socket', async (t) => {
  const originalRequest = https.request;
  let called = false;
  https.request = () => {
    called = true;
    throw new Error('must not open a cancelled request');
  };
  t.after(() => { https.request = originalRequest; });
  const controller = new AbortController();
  const reason = new Error('deadline reached');
  reason.code = 'REQUEST_DEADLINE';
  controller.abort(reason);

  await assert.rejects(requestHttps('https://example.test/path', { signal: controller.signal }), (error) => (
    error.code === 'REQUEST_DEADLINE'
  ));
  assert.equal(called, false);
});

test('HTTPS helper propagates active cancellation and total-deadline failures', async (t) => {
  const originalRequest = https.request;
  const requests = [];
  https.request = (_url, _options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {};
    request.destroy = (error) => request.emit('error', error);
    requests.push(request);
    return request;
  };
  t.after(() => { https.request = originalRequest; });

  const controller = new AbortController();
  const cancelled = requestHttps('https://example.test/cancel', { signal: controller.signal });
  controller.abort(Object.assign(new Error('client disconnected'), { code: 'ABORT_ERR' }));
  await assert.rejects(cancelled, (error) => error.code === 'ABORT_ERR');
  assert.equal(requests.length, 1);

  await assert.rejects(
    requestHttps('https://example.test/deadline', { totalTimeoutMs: 5 }),
    (error) => error.code === 'ETIMEDOUT'
  );
  assert.equal(requests.length, 2);
});
