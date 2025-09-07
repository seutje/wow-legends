function isProd() {
  try { return typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production'; }
  catch { return false; }
}

export function invariant(condition, message = 'Invariant failed') {
  if (!isProd()) {
    if (!condition) throw new Error(message);
  }
}

export const assert = invariant;

export function fail(message = 'Unreachable') {
  throw new Error(message);
}

