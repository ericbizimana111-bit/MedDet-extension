const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../extension/content/capture.js'), 'utf8');

function frameHashPattern(pattern) {
  let value = 128;
  const values = [value];
  for (const bit of pattern) {
    value += bit === '1' ? -6 : 6;
    values.push(value);
  }
  return values;
}

function createCapture(video, visuals, onSleep = () => {}) {
  let visualIndex = 0;
  let imageOptions;
  class Canvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.visual = null;
    }

    getContext() {
      return {
        drawImage: (sourceImage) => { this.visual = sourceImage.currentVisual ?? sourceImage.visual; },
        getImageData: (_x, _y, width, height) => {
          if (width === 1 && height === 1) return { data: new Uint8ClampedArray([120, 120, 120, 255]) };
          const columns = frameHashPattern(this.visual || '11111111');
          const data = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const value = columns[x];
              const offset = (y * width + x) * 4;
              data[offset] = value;
              data[offset + 1] = value;
              data[offset + 2] = value;
              data[offset + 3] = 255;
            }
          }
          return { data };
        },
      };
    }

    toDataURL(mime, quality) {
      imageOptions = { width: this.width, height: this.height, mime, quality };
      return 'data:image/jpeg;base64,/9j/AAAA';
    }
  }

  const sandbox = {
    document: { createElement: () => new Canvas() },
    MedDet: { ui: { hideForCapture() {} } },
    chrome: { runtime: { sendMessage: async () => ({ success: false }) } },
    Image: class {},
    requestAnimationFrame: (callback) => queueMicrotask(callback),
    setTimeout: (callback, ms) => {
      video.currentTime += ms / 1000;
      visualIndex += 1;
      if (visuals[visualIndex]) video.currentVisual = visuals[visualIndex];
      onSleep(visualIndex, video);
      queueMicrotask(callback);
      return visualIndex;
    },
    clearTimeout() {},
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    Uint8ClampedArray,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Blob,
    MediaStream: class {},
    MediaRecorder: class {},
    AudioContext: class {},
    OfflineAudioContext: class {},
    Math,
    Promise,
    Error,
  };
  video.currentVisual = visuals[0];
  vm.runInNewContext(source, sandbox, { filename: 'capture.js' });
  return { capture: sandbox.MedDet.capture, getImageOptions: () => imageOptions };
}

function makeVideo(overrides = {}) {
  return {
    paused: false,
    ended: false,
    isConnected: true,
    readyState: 4,
    currentTime: 0,
    videoWidth: 1280,
    videoHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360 }),
    ...overrides,
  };
}

const changedVisuals = ['11111111', '00000000', '01010101', '10101010', '11001100', '00110011'];

test('playing video captures up to six distinct frames with timestamps and bounded JPEG dimensions', async () => {
  const video = makeVideo();
  const { capture, getImageOptions } = createCapture(video, changedVisuals);
  const frames = await capture.captureFrames(video);

  assert.equal(frames.length, 6);
  assert.deepEqual(Array.from(frames, (frame) => frame.timestamp), [0, 1.1, 2.2, 3.3, 4.4, 5.5]);
  assert.ok(frames.every((frame) => frame.hash && frame.image.startsWith('/9j/')));
  assert.deepEqual(getImageOptions(), { width: 720, height: 405, mime: 'image/jpeg', quality: 0.72 });

  const portrait = makeVideo({ paused: true, videoWidth: 1080, videoHeight: 1920 });
  const portraitCapture = createCapture(portrait, ['11111111']);
  await portraitCapture.capture.captureFrames(portrait);
  assert.deepEqual(portraitCapture.getImageOptions(), { width: 720, height: 1280, mime: 'image/jpeg', quality: 0.72 });
});

test('paused video captures one frame and identical moments are deduplicated', async () => {
  const paused = makeVideo({ paused: true });
  const pausedCapture = createCapture(paused, changedVisuals);
  assert.equal((await pausedCapture.capture.captureFrames(paused)).length, 1);

  const staticVideo = makeVideo();
  const staticCapture = createCapture(staticVideo, Array(6).fill('11111111'));
  const frames = await staticCapture.capture.captureFrames(staticVideo);
  assert.equal(frames.length, 1);
});

test('short videos stop when playback ends and second pass excludes previously captured visuals', async () => {
  const shortVideo = makeVideo();
  const shortCapture = createCapture(shortVideo, changedVisuals, (index, currentVideo) => {
    if (index === 1) currentVideo.ended = true;
  });
  assert.equal((await shortCapture.capture.captureFrames(shortVideo)).length, 1);

  const video = makeVideo({ paused: true });
  const firstCapture = createCapture(video, ['11111111']);
  const prior = await firstCapture.capture.captureFrames(video);
  const secondVideo = makeVideo({ paused: true });
  const secondCapture = createCapture(secondVideo, ['11111111']);
  assert.equal((await secondCapture.capture.captureFrames(secondVideo, { excludeFrames: prior })).length, 0);
});

test('capture fails explicitly when the video is not ready', async () => {
  const video = makeVideo({ readyState: 0 });
  const { capture } = createCapture(video, changedVisuals);
  await assert.rejects(capture.captureFrames(video), (error) => error.code === 'NOT_READY');
});
