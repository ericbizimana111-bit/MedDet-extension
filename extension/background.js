// MedDet service worker: the only place that talks to the backend or captures the tab.
// No API keys live here. Keys stay on the server.

const DEFAULT_BACKEND = 'http://localhost:5000';

async function backendUrl() {
  const { backendUrl: u } = await chrome.storage.sync.get('backendUrl');
  return (u || DEFAULT_BACKEND).replace(/\/+$/, '');
}

const fail = (code, message) => ({ success: false, error: { code, message } });

async function identify(kind, body) {
  const base = await backendUrl();
  let res;
  try {
    res = await fetch(`${base}/api/v1/identify/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') return fail('TIMEOUT', 'The server took too long to answer. Please try again.');
    return fail('NETWORK', 'MedDet could not reach its server. Check your connection and the server address in the MedDet popup.');
  }
  try {
    return await res.json();
  } catch {
    return fail('BAD_RESPONSE', 'The server sent an unexpected response.');
  }
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
  if (!/^https:\/\/image\.tmdb\.org\//.test(url)) return fail('BAD_URL', 'Image host not allowed.');
  try {
    const res = await fetch(url);
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
      case 'IDENTIFY': return identify(msg.kind, msg.body);
      case 'CAPTURE_TAB': return captureTab(sender);
      case 'IMAGE': return fetchImage(msg.url);
      default: return fail('UNKNOWN', 'Unknown message.');
    }
  })().then(sendResponse).catch((e) => sendResponse(fail('EXT_ERROR', e.message)));
  return true; // async response
});
