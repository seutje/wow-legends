// Simple browser-only debug logger switcher.
// By default, console.log is disabled in the browser to avoid noisy output.
// Tests already silence console in jest.setup.js; tools remain unaffected (Node).

let originals = null;
let enabled = false;
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export function setDebugLogging(on) {
  enabled = !!on;
  if (typeof window === 'undefined') return; // Don't touch Node tools
  if (!originals) {
    originals = {
      log: console.log,
    };
  }
  console.log = enabled ? originals.log : function noop() {};
}

export function isDebugLogging() { return !!enabled; }

// Initialize disabled by default in the browser
if (typeof window !== 'undefined') {
  setDebugLogging(false);
}

export function createLogger(tag = 'app', level = 'info') {
  const norm = (lvl) => (LEVELS[lvl] != null ? lvl : 'info');
  let current = norm(level);
  const should = (lvl) => LEVELS[lvl] >= LEVELS[current];
  const prefix = (method, args) => [
    `[${tag}]`,
    ...args,
  ];
  return {
    setLevel(lvl) { current = norm(lvl); },
    getLevel() { return current; },
    debug: (...args) => { if (should('debug')) console.log(...prefix('debug', args)); },
    info: (...args) => { if (should('info')) console.info ? console.info(...prefix('info', args)) : console.log(...prefix('info', args)); },
    warn: (...args) => { if (should('warn')) console.warn ? console.warn(...prefix('warn', args)) : console.log(...prefix('warn', args)); },
    error: (...args) => { if (should('error')) console.error ? console.error(...prefix('error', args)) : console.log(...prefix('error', args)); },
  };
}
