// Simple debug logging switcher for both browser and Node.
// By default, console.log is silenced to avoid noisy output in CLI and UI.

let originals = null;
let enabled = false;
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

function ensureOriginals() {
  if (!originals) {
    originals = {
      log: console.log,
      info: console.info ? console.info.bind(console) : console.log.bind(console),
      warn: console.warn ? console.warn.bind(console) : console.log.bind(console),
      error: console.error ? console.error.bind(console) : console.log.bind(console),
    };
  }
}

function debugLogWrapper(...args) {
  if (!enabled) return;
  ensureOriginals();
  return originals.log(...args);
}
debugLogWrapper.__isDebugWrapper = true;

export function setDebugLogging(on) {
  enabled = !!on;
  ensureOriginals();
  if (!console.log.__isDebugWrapper) {
    console.log = debugLogWrapper;
  }
}

export function isDebugLogging() { return !!enabled; }

export function getOriginalConsole() {
  ensureOriginals();
  return originals;
}

// Initialize disabled by default in all environments
setDebugLogging(false);

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
    info: (...args) => { if (should('info')) (console.info ? console.info(...prefix('info', args)) : console.log(...prefix('info', args))); },
    warn: (...args) => { if (should('warn')) (console.warn ? console.warn(...prefix('warn', args)) : console.log(...prefix('warn', args))); },
    error: (...args) => { if (should('error')) (console.error ? console.error(...prefix('error', args)) : console.log(...prefix('error', args))); },
  };
}
