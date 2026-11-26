const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const uiSource = fs.readFileSync(path.resolve(__dirname, '../../extension/content/ui.js'), 'utf8');

function createUiHarness() {
  const sandbox = { MedDet: {}, URL, Promise };
  vm.runInNewContext(uiSource, sandbox, { filename: 'ui.js' });
  return sandbox.MedDet.ui;
}

function makeFigure() {
  const image = { hidden: true };
  Object.defineProperty(image, 'src', {
    set(value) {
      this.value = value;
      queueMicrotask(() => {
        if (value === 'data:image/jpeg;base64,/9j/AAAA') this.onload?.();
        else this.onerror?.();
      });
    },
  });
  const element = {
    hidden: true,
    removed: false,
    attributes: {},
    classes: new Set(),
    classList: {
      add(name) { element.classes.add(name); },
      remove(name) { element.classes.delete(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    remove() { this.removed = true; },
  };
  return { element, image, caption: { textContent: '' } };
}

const backdrop = 'https://image.tmdb.org/t/p/w780/backdrop-123.jpg';
const poster = 'https://image.tmdb.org/t/p/w342/poster-123.jpg';
const sceneFrame = { dataUrl: 'data:image/jpeg;base64,/9j/AAAA', timestamp: 4.2 };

test('TMDB backdrop takes priority over poster and analyzed-scene fallback', async () => {
  const ui = createUiHarness();
  const sources = ui.artworkSources({ backdrop, poster }, sceneFrame);
  assert.deepEqual(Array.from(sources, (source) => source.kind), ['backdrop', 'poster', 'scene']);
  assert.equal(sources[0].url, backdrop);
  assert.equal(sources[1].url, poster);
});

test('poster is the main-art fallback when backdrop is missing or invalid', () => {
  const ui = createUiHarness();
  const sources = ui.artworkSources({ backdrop: 'https://example.com/fake.jpg', poster }, null);
  assert.deepEqual(Array.from(sources, (source) => source.kind), ['poster']);
  assert.equal(sources[0].url, poster);
});

test('captured video frame is the final fallback and is labeled as the analyzed scene', () => {
  const ui = createUiHarness();
  const sources = ui.artworkSources({ backdrop: '/invalid.jpg', poster: null }, sceneFrame);
  assert.deepEqual(Array.from(sources, (source) => source.kind), ['scene']);
  assert.equal(sources[0].dataUrl, sceneFrame.dataUrl);
  assert.equal(sources[0].label, 'Scene analyzed');
});

test('missing artwork and invalid scene data produce no image source', () => {
  const ui = createUiHarness();
  assert.equal(ui.artworkSources({ poster: null, backdrop: null }, null).length, 0);
  assert.equal(ui.artworkSources({
    poster: 'https://image.tmdb.org/t/p/w342/../../fake.jpg',
    backdrop: 'https://image.tmdb.org.evil.test/t/p/w780/fake.jpg',
  }, { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }).length, 0);
});

test('failed official artwork falls through to captured frame without leaving a broken image', async () => {
  const ui = createUiHarness();
  const figure = makeFigure();
  const sources = ui.artworkSources({ backdrop, poster }, sceneFrame);
  const requested = [];
  const chosen = await ui.loadArtwork(figure, sources, async (url) => {
    requested.push(url);
    if (url === backdrop) return null;
    return 'data:image/jpeg;base64,not-a-decodable-image';
  });

  assert.equal(chosen, 'scene');
  assert.deepEqual(requested, [backdrop, poster]);
  assert.equal(figure.caption.textContent, 'Scene analyzed');
  assert.equal(figure.element.hidden, false);
  assert.equal(figure.image.hidden, false);
  assert.equal(figure.element.attributes['aria-busy'], 'false');
  assert.equal(figure.element.classes.has('loading'), false);
  assert.equal(figure.image.value, sceneFrame.dataUrl);
});

test('all missing or undecodable images remove the empty artwork element', async () => {
  const ui = createUiHarness();
  const figure = makeFigure();
  const chosen = await ui.loadArtwork(figure, [], async () => null);
  assert.equal(chosen, null);
  assert.equal(figure.element.removed, true);
});
