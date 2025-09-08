/**
 * Jest setup file to silence console output during tests.
 */
function noop() {}
console.log = noop;
console.info = noop;
console.warn = noop;
console.error = noop;
