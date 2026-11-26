// MedDet service worker: the only place that talks to the backend or captures the tab.
// No API keys live here. Keys stay on the server.

const DEFAULT_BACKEND = 'http://localhost:5000';
const activeIdentifications = new Map();

async function backendUrl() {
  const { backendUrl: u } = await chrome.storage.sync.get('backendUrl');
  return (u || DEFAULT_BACKEND).replace(/\/+$/, '');
}

const fail = (code, message) => ({ success: false, error: { code, message } });

async function identify(kind, body, requestId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Identification timed out', 'TimeoutError')), 60_000);
  if (requestId) activeIdentifications.set(requestId, controller);
  let res;
  try {
    const base = await backendUrl();
    res = await fetch(`${base}/api/v1/identify/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.reason?.name === 'TimeoutError') return fail('TIMEOUT', 'The server took too long to answer. Please try again.');
    if (controller.signal.aborted) return fail('CANCELLED', 'Identification was cancelled.');
    return fail('NETWORK', 'MedDet could not reach its server. Check your connection and the server address in the MedDet popup.');
  } finally {
    clearTimeout(timeout);
    if (requestId && activeIdentifications.get(requestId) === controller) activeIdentifications.delete(requestId);
  }
  try {
    return await res.json();
  } catch {
    return fail('BAD_RESPONSE', 'The server sent an unexpected response.');
  }
}

function cancelIdentification(requestId) {
  const controller = activeIdentifications.get(requestId);
  if (controller) controller.abort(new DOMException('Identification cancelled', 'AbortError'));
  return { success: true };
}

async function captureTab(sender) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 85 });
    return { success: true, dataUrl };
  } catch (e) {
    return fail('CAPTURE_BLOCKED', 'The browser did not allow capturing this tab.');
  }
}

// Page CSP can block remote images in injected UI, so poster images are fetched here.
async function fetchImage(url) {
  if (typeof url !== 'string'
      || !/^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d{2,4}|original)\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url)) {
    return fail('BAD_URL', 'Image host or path not allowed.');
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return fail('IMAGE', 'Image unavailable.');
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { success: true, dataUrl: `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${btoa(bin)}` };
  } catch {
    return fail('IMAGE', 'Image unavailable.');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'IDENTIFY': return identify(msg.kind, msg.body, msg.requestId);
      case 'CANCEL_IDENTIFY': return cancelIdentification(msg.requestId);
      case 'CAPTURE_TAB': return captureTab(sender);
      case 'IMAGE': return fetchImage(msg.url);
      default: return fail('UNKNOWN', 'Unknown message.');
    }
  })().then(sendResponse).catch((e) => sendResponse(fail('EXT_ERROR', e.message)));
  return true; // async response
});
