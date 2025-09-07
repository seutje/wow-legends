const levels = ['debug', 'info', 'warn', 'error', 'silent'];

function isProd() {
  try { return typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production'; }
  catch { return false; }
}

export function createLogger(namespace = 'app', level = 'info') {
  const prod = isProd();
  let idx = Math.max(0, levels.indexOf(level));
  if (idx === -1) idx = 1; // default info

  const out = {};
  const bind = (method, minLevel) => {
    if (prod) return () => {};
    const minIdx = levels.indexOf(minLevel);
    return (...args) => {
      if (idx <= minIdx) {
        // eslint-disable-next-line no-console
        console[method](`[${namespace}]`, ...args);
      }
    };
  };

  out.debug = bind('log', 'debug');
  out.info = bind('info', 'info');
  out.warn = bind('warn', 'warn');
  out.error = bind('error', 'error');
  out.setLevel = (lvl) => { const i = levels.indexOf(lvl); if (i !== -1) idx = i; };

  return out;
}

