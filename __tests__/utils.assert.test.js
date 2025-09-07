import { invariant, fail } from '../src/js/utils/assert.js';

describe('assert/invariant', () => {
  const old = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = old; });

  test('throws in dev when condition false', () => {
    process.env.NODE_ENV = 'test';
    expect(() => invariant(false, 'nope')).toThrow('nope');
  });

  test('no-ops in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => invariant(false, 'nope')).not.toThrow();
  });

  test('fail always throws', () => {
    expect(() => fail('boom')).toThrow('boom');
  });
});

