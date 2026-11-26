const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { movieSchema, musicSchema } = require('../src/validators/identify.validators');

const image = fs.readFileSync(path.resolve(__dirname, '../../extension/icons/16.png')).toString('base64');

test('movie request accepts a real PNG payload and defaults the platform', () => {
  const parsed = movieSchema.parse({ frames: [{ image, timestamp: 1.5 }] });
  assert.equal(parsed.platform, 'other');
  assert.equal(parsed.frames[0].image, image);
});

test('movie request rejects missing frames, malformed image data, and unsupported MIME types', () => {
  assert.equal(movieSchema.safeParse({}).success, false);
  assert.equal(movieSchema.safeParse({ frames: [{ image: 'not-an-image'.padEnd(120, 'x') }] }).success, false);
  assert.equal(movieSchema.safeParse({
    frames: [{ image, mimeType: 'image/gif' }],
  }).success, false);
  assert.equal(movieSchema.safeParse({
    frames: [{ image, mimeType: 'image/jpeg' }],
  }).success, false);
});

test('movie request accepts a matching image data URL MIME type', () => {
  const parsed = movieSchema.parse({ frames: [{ image: `data:image/png;base64,${image}` }] });
  assert.equal(parsed.frames[0].image, image);
});

test('movie request validates initial and additional-pass frame contracts', () => {
  const sessionId = Buffer.alloc(32, 1).toString('base64url');
  const initial = movieSchema.parse({
    frames: [{ image, timestamp: 2 }],
    videoContext: { currentTime: 3, duration: 10, width: 720, height: 1280, paused: false },
  });
  assert.equal(initial.pass, 'initial');
  assert.equal(initial.videoContext.height, 1280);

  const additional = movieSchema.parse({
    pass: 'additional',
    sessionId,
    priorFrames: [{ image, timestamp: 2 }],
    frames: [{ image, timestamp: 8 }],
  });
  assert.equal(additional.pass, 'additional');
  assert.equal(additional.priorFrames.length, 1);
  assert.equal(movieSchema.safeParse({
    pass: 'additional',
    sessionId: 'client-invented',
    priorFrames: [{ image }],
    frames: [{ image }],
  }).success, false);
  assert.equal(movieSchema.safeParse({ pass: 'initial', sessionId, frames: [{ image }] }).success, false);
});

test('music request validates required audio and its declared MIME type', () => {
  assert.equal(musicSchema.safeParse({}).success, false);
  assert.equal(musicSchema.safeParse({
    audio: Buffer.alloc(100).toString('base64'),
    mimeType: 'audio/wav',
  }).success, true);
  assert.equal(musicSchema.safeParse({
    audio: Buffer.alloc(100).toString('base64'),
    mimeType: 'audio/flac',
  }).success, false);
  const encoded = Buffer.alloc(100).toString('base64');
  assert.equal(musicSchema.safeParse({
    audio: `data:audio/wav;base64,${encoded}`,
    mimeType: 'audio/mpeg',
  }).success, false);
});
