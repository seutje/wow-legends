// Client-side live reload poller for dev
// Polls live-reload.json (relative to the current page) and reloads
// the page when the `time` or `version` changes. Using a relative
// path ensures it works when served from a subfolder (e.g. GitHub Pages).

const ENDPOINT = './live-reload.json';
const INTERVAL_MS = 1000;

let lastVersion = null;
let lastTime = null;

async function check() {
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const v = data.version ?? null;
    const t = data.time ?? null;
    if (lastVersion === null && lastTime === null) {
      lastVersion = v;
      lastTime = t;
      return;
    }
    if (v !== lastVersion || t !== lastTime) {
      console.log('[live-reload] change detected -> reloading');
      location.reload();
    }
  } catch (e) {
    // Silently ignore; will retry on next tick
  }
}

setInterval(check, INTERVAL_MS);
