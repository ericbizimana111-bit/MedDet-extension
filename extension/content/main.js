// Orchestration: follows the playing video, keeps one MedDet button on it, runs identifications.
(function () {
  const { ui, capture, platform } = MedDet;
  let enabled = true;
  let locked = null;      // video being identified; the button will not jump away while a panel is open
  let token = null;       // cancel token for the current run
  let lastTick = 0;

  chrome.storage.sync.get('enabled').then((v) => { enabled = v.enabled !== false; });
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled) { enabled = c.enabled.newValue !== false; if (!enabled) { ui.closeAll(); ui.setButton(null); } }
  });

  const isPlaying = (v) => !v.paused && !v.ended && v.readyState > 2;

  function visibleArea(r) {
    return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
  }

  /** The video the user is most likely watching: big, on screen, and playing. */
  function pickVideo() {
    let best = null, bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      const area = visibleArea(r);
      if (area / (r.width * r.height) < 0.4) continue;
      const score = area * (isPlaying(v) ? 3 : 1) * (v.currentTime > 0 || isPlaying(v) ? 1 : 0.2);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastTick < 100) return;
    lastTick = now;
    if (!enabled) return;
    const v = locked || pickVideo();
    if (!v || !v.isConnected) {
      if (locked) { locked = null; token && (token.cancelled = true); ui.closeAll(); }
      return ui.setButton(null);
    }
    const r = v.getBoundingClientRect();
    if (visibleArea(r) < 4000) { if (locked) { locked = null; ui.closeAll(); } return ui.setButton(null); }
    const o = platform.offset;
    const x = Math.min(innerWidth - 52, Math.max(8, Math.min(r.right, innerWidth) - 40 - o.right));
    const y = Math.max(8, Math.max(r.top, 0) + o.top);
    ui.mount();
    ui.setButton({ x, y });
    if (!locked) current = v;
  }
  let current = null;

  const sendMsg = (m) => chrome.runtime.sendMessage(m);
  const loadImage = async (url) => {
    if (!url) return null;
    const r = await sendMsg({ type: 'IMAGE', url });
    return r?.success ? r.dataUrl : null;
  };

  const ERRORS = {
    NETWORK: ['Can’t reach MedDet', 'Check your internet connection. If the problem continues, the server may be offline.'],
    RATE_LIMITED: ['Free limit reached', 'You have used the free identifications available for now. Try again in a while.'],
    DAILY_CAPACITY: ['MedDet is full for today', 'The free daily capacity has been used. Please try again tomorrow.'],
    PROTECTED: ['This video can’t be analysed', 'It looks protected or blank, and MedDet does not bypass protections.'],
    CAPTURE_BLOCKED: ['Capture was blocked', 'The browser did not allow capturing this video. Try another video.'],
    NOT_VISIBLE: ['Video not visible', 'Keep the video fully on screen while MedDet looks at it.'],
    NOT_READY: ['Video still loading', 'Wait until the video is playing, then try again.'],
    PAUSED: ['Play the video first', 'MedDet listens to the sound while the video plays.'],
    SILENT: ['No sound captured', 'Unmute the video and make sure music is audible, then try again.'],
    NO_AUDIO: ['No audio found', 'This video has no sound track to analyse.'],
    UNSUPPORTED: ['Audio capture unavailable', 'This browser can’t capture audio from this video.'],
    DECODE: ['Audio couldn’t be read', 'Try again while the video is playing.'],
  };

  function showError(code, serverMessage) {
    const [title, body] = ERRORS[code] || ['Something went wrong', serverMessage || 'Please try again.'];
    ui.showMessage({ title, body: ERRORS[code] ? body : serverMessage || body, actionLabel: 'Back', onAction: () => ui.reopenMenu() });
  }

  async function run(kind) {
    const video = (locked = current);
    if (!video) return;
    const my = (token = { cancelled: false });
    const cancel = () => { my.cancelled = true; locked = null; ui.closeAll(); };
    try {
      let res;
      if (kind === 'movie') {
        ui.showProgress('Looking at the video', 'Capturing a few moments…', { onCancel: cancel, fraction: 0 });
        const frames = await capture.captureFrames(video, {
          token: my,
          onProgress: (i, n) => ui.showProgress('Looking at the video', `Capturing scene ${i} of ${n}…`, { onCancel: cancel, fraction: i / (n + 1) }),
        });
        if (my.cancelled) return;
        ui.showProgress('Identifying', 'Matching the scene and checking the movie database…', { onCancel: cancel });
        res = await sendMsg({ type: 'IDENTIFY', kind: 'movie', body: { frames, platform: platform.name, videoContext: { currentTime: video.currentTime } } });
      } else {
        const audio = await capture.captureAudio(video, {
          token: my,
          onTick: (s, n) => ui.showProgress('Listening', `Listening for the song… ${s} of ${n} seconds`, { onCancel: cancel, fraction: s / n }),
        });
        if (my.cancelled) return;
        ui.showProgress('Identifying', 'Looking for a matching song…', { onCancel: cancel });
        res = await sendMsg({ type: 'IDENTIFY', kind: 'music', body: { audio, mimeType: 'audio/wav', platform: platform.name } });
      }
      if (my.cancelled) return;

      if (!res?.success) return showError(res?.error?.code, res?.error?.message);
      const d = res.data;
      const retry = () => ui.reopenMenu();
      if (d.status === 'no_match') {
        return ui.showMessage({ title: kind === 'movie' ? 'No reliable match' : 'No song recognised', body: d.message, actionLabel: 'Try again', onAction: retry });
      }
      if (kind === 'movie') ui.showMovie(d.matches, loadImage, { onRetry: retry });
      else ui.showMusic(d.track, { onRetry: retry });
    } catch (e) {
      if (my.cancelled || e.code === 'CANCELLED') return;
      showError(e.code, e.message);
    }
    // `locked` stays set while a result is on screen so the button stays with its video.
    // It is released when the panel is closed (see ui.onClose) or the video leaves the screen.
  }

  // The panel is for one video. If the user closes it, release the lock so the button can follow another video.
  ui.onClose(() => { token && (token.cancelled = true); locked = null; });

  function init() {
    ui.mount();
    ui.onPick((kind) => run(kind));
    requestAnimationFrame(tick);
  }
  init();
})();
