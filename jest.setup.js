import { deserialize, serialize } from 'node:v8';

/**
 * Jest setup file to silence console output during tests.
 */
function noop() {}
console.log = noop;
console.info = noop;
console.warn = noop;
console.error = noop;

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (value) => deserialize(serialize(value));
}
