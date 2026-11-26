// Media capture: video frames and a short audio sample, only when the user asks.
// Uses supported browser mechanisms only. Never tries to get around DRM.
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class CaptureError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // ---------- frames ----------
  const MAX_W = 960;
  const MAX_FRAME_DATA_URL_LENGTH = 850_000;

  function drawVideo(video) {
    if (video.readyState < 2 || !video.videoWidth) throw new CaptureError('NOT_READY', 'The video has not loaded yet.');
    const s = Math.min(1, MAX_W / video.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * s);
    c.height = Math.round(video.videoHeight * s);
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, c.width, c.height);
    ctx.getImageData(0, 0, 1, 1); // throws SecurityError if the canvas is tainted (cross-origin video)
    return c;
  }

  async function drawFromTab(video) {
    MedDet.ui.hideForCapture(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(60);
    let res;
    try { res = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }); }
    finally { MedDet.ui.hideForCapture(false); }
    if (!res?.success) throw new CaptureError('CAPTURE_BLOCKED', 'The browser did not allow capturing this video.');

    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = res.dataUrl; });
    const r = video.getBoundingClientRect();
    const k = img.naturalWidth / window.innerWidth;
    const sx = Math.max(0, r.left) * k, sy = Math.max(0, r.top) * k;
    const sw = (Math.min(window.innerWidth, r.right) - Math.max(0, r.left)) * k;
    const sh = (Math.min(window.innerHeight, r.bottom) - Math.max(0, r.top)) * k;
    if (sw < 20 || sh < 20) throw new CaptureError('NOT_VISIBLE', 'The video is not visible on screen.');
    const s = Math.min(1, MAX_W / sw);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  // 9x8 grayscale difference hash: tiny, fast way to spot near-identical frames.
  function dHash(canvas) {
    const t = document.createElement('canvas');
    t.width = 9; t.height = 8;
    const ctx = t.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = (x, y) => { const i = (y * 9 + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
    let bits = '', sum = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { bits += g(x, y) > g(x + 1, y) ? '1' : '0'; sum += g(x, y); }
    return { bits, mean: sum / 64 };
  }
  const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

  function encodeFrame(canvas) {
    let source = canvas;
    let quality = 0.84;
    let dataUrl = source.toDataURL('image/jpeg', quality);
    while (dataUrl.length > MAX_FRAME_DATA_URL_LENGTH && quality > 0.62) {
      quality = Math.max(0.62, quality - 0.08);
      dataUrl = source.toDataURL('image/jpeg', quality);
    }
    while (dataUrl.length > MAX_FRAME_DATA_URL_LENGTH && source.width > 320) {
      const scale = Math.max(0.75, 320 / source.width);
      const smaller = document.createElement('canvas');
      smaller.width = Math.round(source.width * scale);
      smaller.height = Math.round(source.height * scale);
      smaller.getContext('2d').drawImage(source, 0, 0, smaller.width, smaller.height);
      source = smaller;
      quality = 0.72;
      dataUrl = source.toDataURL('image/jpeg', quality);
    }
    if (dataUrl.length > MAX_FRAME_DATA_URL_LENGTH) {
      throw new CaptureError('FRAME_TOO_LARGE', 'This video frame could not be compressed enough to analyze.');
    }
    return dataUrl.split(',')[1];
  }

  async function grab(video, state) {
    if (state.method !== 'tab') {
      try {
        const c = drawVideo(video);
        if (dHash(c).mean > 6) { state.method = 'video'; return c; }
        // Black frame: often protected video. Try the tab capture once.
        state.sawBlack = true;
      } catch (e) {
        if (e instanceof CaptureError) throw e;
        /* tainted canvas: fall through to tab capture */
      }
      state.method = 'tab';
    }
    const c = await drawFromTab(video);
    if (dHash(c).mean <= 6) throw new CaptureError('PROTECTED', 'This video is protected or blank, so it cannot be analysed.');
    return c;
  }

  async function captureFrames(video, { count = 6, intervalMs = 1000, onProgress, token, excludeFrames = [] } = {}) {
    const frames = [], hashes = excludeFrames.map((f) => f.hash).filter(Boolean), state = { method: null };
    const target = video.paused ? 1 : Math.min(count, 6);
    let previousSampleHash = null;
    for (let i = 0; i < target; i++) {
      if (token?.cancelled) throw new CaptureError('CANCELLED', 'Cancelled.');
      if (!video.isConnected || (i > 0 && (video.paused || video.ended))) break;
      onProgress?.(i + 1, target);
      let c;
      try { c = await grab(video, state); }
      catch (e) {
        // A later black frame (scene fade) should not discard frames we already have.
        if (e.code === 'PROTECTED' && frames.length) { if (i < target - 1) await sleep(intervalMs); continue; }
        throw e;
      }
      const h = dHash(c).bits;
      const visualChange = previousSampleHash ? hamming(previousSampleHash, h) : 64;
      previousSampleHash = h;
      if (!hashes.some((x) => hamming(x, h) < 5)) {
        hashes.push(h);
        frames.push({
          image: encodeFrame(c),
          timestamp: Math.round(video.currentTime * 10) / 10,
          hash: h,
        });
      }
      c.width = 0; c.height = 0;
      // Sample again sooner after a cut so short-lived montage footage is less likely to be skipped.
      if (i < target - 1) await sleep(visualChange >= 20 ? Math.min(350, intervalMs) : intervalMs);
    }
    if (!frames.length && !excludeFrames.length) {
      throw new CaptureError('NO_FRAMES', 'No usable video frames could be captured.');
    }
    return frames;
  }

  // ---------- audio ----------
  function toWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  const toBase64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };

  async function captureAudio(video, { seconds = 12, onTick, token } = {}) {
    if (video.paused) throw new CaptureError('PAUSED', 'Play the video first, then choose Identify song.');
    const capture = video.captureStream || video.mozCaptureStream;
    if (!capture) throw new CaptureError('UNSUPPORTED', 'This browser cannot capture audio from this video.');
    const stream = capture.call(video);
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) throw new CaptureError('NO_AUDIO', 'This video has no audio to analyse.');

    const mime = ['audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(new MediaStream(audioTracks), mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(500);
    for (let s = 0; s < seconds; s++) {
      if (token?.cancelled) { rec.stop(); throw new CaptureError('CANCELLED', 'Cancelled.'); }
      onTick?.(s + 1, seconds);
      await sleep(1000);
    }
    rec.stop();
    await stopped;

    const ctx = new AudioContext();
    let decoded;
    try { decoded = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer()); }
    catch { throw new CaptureError('DECODE', 'The audio could not be read from this video.'); }
    finally { ctx.close(); }

    const RATE = 8000;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);

    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    if (Math.sqrt(sum / pcm.length) < 0.003) {
      throw new CaptureError('SILENT', 'No sound was captured. Unmute the video and try again.');
    }
    return toBase64(toWav(pcm, RATE));
  }

  MedDet.capture = { captureFrames, captureAudio, CaptureError };
})();
