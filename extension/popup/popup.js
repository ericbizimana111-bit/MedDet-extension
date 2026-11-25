const $ = (id) => document.getElementById(id);
const DEFAULT = 'http://localhost:5000';

async function check(base) {
  const el = $('status');
  el.className = ''; el.textContent = 'Checking…';
  try {
    const res = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(6000) });
    const { data } = await res.json();
    const s = data.services;
    const parts = [`Movies and shows: ${s.movie ? 'ready' : 'not set up'}`, `Music: ${s.music ? 'ready' : 'not set up'}`];
    el.className = s.movie || s.music ? 'ok' : 'bad';
    el.textContent = `Connected. ${parts.join('. ')}.`;
  } catch {
    el.className = 'bad';
    el.textContent = 'Can’t reach the server. Is it running at this address?';
  }
}

(async () => {
  const { enabled, backendUrl } = await chrome.storage.sync.get(['enabled', 'backendUrl']);
  $('enabled').checked = enabled !== false;
  $('server').value = backendUrl || DEFAULT;
  $('enabled').addEventListener('change', (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
  $('save').addEventListener('click', async () => {
    const base = $('server').value.trim().replace(/\/+$/, '') || DEFAULT;
    await chrome.storage.sync.set({ backendUrl: base });
    check(base);
  });
  check(backendUrl || DEFAULT);
})();
