// Orchestration: follows the playing video, keeps one MedDet button on it, runs identifications.
(function () {
  const { ui, capture, platform } = MedDet;
  let enabled = true;
  let locked = null;      // video being identified; the button will not jump away while a panel is open
  let token = null;       // cancel token for the current run
  let busy = false;
  let activeRequestId = null;
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
    TIMEOUT: ['Analysis timed out', 'The analysis took too long. Please try again later.'],
    AI_TIMEOUT: ['Analysis timed out', 'The analysis service took too long to respond. Please try again later.'],
    REQUEST_TIMEOUT: ['Analysis timed out', 'The complete analysis took too long. Please try again later.'],
    AI_BUSY: ['Analysis temporarily unavailable', 'The analysis service is busy. Please try again shortly.'],
    AI_QUOTA: ['Analysis temporarily unavailable', 'The analysis service is busy. Please try again shortly.'],
    AI_UNAVAILABLE: ['Analysis temporarily unavailable', 'The analysis service could not be reached. Please try again later.'],
    AI_REJECTED: ['Analysis configuration issue', 'The analysis service rejected the request. Please contact the MedDet server administrator.'],
    AI_INVALID_RESPONSE: ['Analysis could not be completed', 'The analysis service returned an invalid result. Please try again later.'],
    GEMINI_NOT_CONFIGURED: ['Movie analysis is not configured', 'The MedDet server administrator needs to configure the analysis service.'],
    METADATA_BUSY: ['Movie lookup temporarily unavailable', 'The movie database is busy. Please try again shortly.'],
    METADATA_UNAVAILABLE: ['Movie lookup temporarily unavailable', 'The movie database could not be reached. Please try again later.'],
    METADATA_TIMEOUT: ['Movie lookup timed out', 'The movie database took too long to respond. Please try again.'],
    METADATA_INVALID_RESPONSE: ['Movie lookup could not be completed', 'The movie database returned an invalid result. Please try again later.'],
    TMDB_NOT_CONFIGURED: ['Movie lookup is not configured', 'The MedDet server administrator needs to configure the movie database.'],
    TMDB_REJECTED: ['Movie lookup configuration issue', 'The movie database rejected the server credentials. Please contact the MedDet server administrator.'],
    SESSION_EXPIRED: ['Analysis session expired', 'Start a new identification to analyze this video again.'],
    SESSION_COMPLETE: ['Analysis already completed', 'Start a new identification to analyze this video again.'],
    SESSION_FRAME_MISMATCH: ['Analysis could not continue', 'The previous visual evidence did not match this session. Start a new identification.'],
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

  const requestFrames = (frames) => frames.map(({ image, timestamp }) => ({ image, timestamp }));

  async function run(kind, continuation = null) {
    if (busy) return;
    const video = (locked || current);
    if (!video) return;
    busy = true;
    locked = video;
    const my = (token = { cancelled: false });
    const cancel = () => {
      my.cancelled = true;
      if (activeRequestId) sendMsg({ type: 'CANCEL_IDENTIFY', requestId: activeRequestId });
      locked = null;
      ui.closeAll();
    };
    try {
      let res;
      if (kind === 'movie') {
        const priorFrames = continuation?.frames || [];
        const pass = continuation ? 'additional' : 'initial';
        ui.showProgress('Looking at the video', continuation ? 'Capturing new moments…' : 'Capturing a few moments…', { onCancel: cancel });
        const frames = await capture.captureFrames(video, {
          count: 6,
          intervalMs: 1000,
          excludeFrames: priorFrames,
          token: my,
          onProgress: (i, n) => ui.showProgress('Looking at the video', `Checking visual moment ${i} of ${n}…`, { onCancel: cancel }),
        });
        if (my.cancelled) return;
        if (continuation && !frames.length) {
          ui.showMessage({
            title: 'No new visual evidence yet',
            body: 'Move the video to a different moment or let it play, then analyze again.',
            actionLabel: 'Analyze more of this video',
            onAction: () => run('movie', continuation),
            secondaryActionLabel: 'Try again',
            onSecondaryAction: () => ui.reopenMenu(),
          });
          return;
        }
        ui.showProgress('Analyzing the scene', 'Checking possible movie matches…', { onCancel: cancel });
        const requestId = crypto.randomUUID();
        activeRequestId = requestId;
        const body = continuation
          ? {
              pass,
              sessionId: continuation.sessionId,
              frames: requestFrames(frames),
              priorFrames: requestFrames(priorFrames),
              platform: platform.name,
              videoContext: {
                currentTime: video.currentTime,
                duration: Number.isFinite(video.duration) ? video.duration : undefined,
                width: video.videoWidth || undefined,
                height: video.videoHeight || undefined,
                paused: video.paused,
              },
            }
          : {
              pass,
              frames: requestFrames(frames),
              platform: platform.name,
              videoContext: {
                currentTime: video.currentTime,
                duration: Number.isFinite(video.duration) ? video.duration : undefined,
                width: video.videoWidth || undefined,
                height: video.videoHeight || undefined,
                paused: video.paused,
              },
            };
        res = await sendMsg({ type: 'IDENTIFY', kind: 'movie', body, requestId });
        if (activeRequestId === requestId) activeRequestId = null;
        if (my.cancelled) return;

        if (!res?.success) return showError(res?.error?.code, res?.error?.message);
        const d = res.data;
        const retry = () => ui.reopenMenu();
        if (d.status === 'insufficient_evidence') {
          const next = d.sessionId ? () => run('movie', { sessionId: d.sessionId, frames: [...priorFrames, ...frames] }) : null;
          return ui.showMessage({
            title: 'More visual evidence needed',
            body: [d.message, d.uncertaintyReason].filter(Boolean).join(' '),
            actionLabel: next ? 'Analyze more of this video' : 'Try again',
            onAction: next || retry,
            secondaryActionLabel: next ? 'Try another video' : undefined,
            onSecondaryAction: next ? retry : undefined,
          });
        }
        if (d.status === 'no_match') {
          return ui.showMessage({
            title: 'No match found',
            body: [d.message, d.uncertaintyReason].filter(Boolean).join(' '),
            actionLabel: 'Try again',
            onAction: retry,
          });
        }
        if (d.status === 'possible_match') {
          const next = d.sessionId ? () => run('movie', { sessionId: d.sessionId, frames: [...priorFrames, ...frames] }) : null;
          return ui.showMovie(d.matches, loadImage, { onRetry: retry, onAnalyzeMore: next, status: d.status });
        }
        if (d.status === 'completed') {
          return ui.showMovie(d.matches, loadImage, { onRetry: retry, status: d.status });
        }
        return showError('BAD_RESPONSE', 'The server returned an unexpected identification status.');
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
    } finally {
      busy = false;
      activeRequestId = null;
    }
    // `locked` stays set while a result is on screen so the button stays with its video.
    // It is released when the panel is closed (see ui.onClose) or the video leaves the screen.
  }

  // The panel is for one video. If the user closes it, release the lock so the button can follow another video.
  ui.onClose(() => {
    token && (token.cancelled = true);
    if (activeRequestId) sendMsg({ type: 'CANCEL_IDENTIFY', requestId: activeRequestId });
    activeRequestId = null;
    locked = null;
  });

  function init() {
    ui.mount();
    ui.onPick((kind) => run(kind));
    requestAnimationFrame(tick);
  }
  init();
})();
