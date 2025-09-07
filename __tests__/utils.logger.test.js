import { createLogger } from '../src/js/utils/logger.js';
import { jest } from '@jest/globals';

describe('logger', () => {
  test('methods exist and respect level (dev)', () => {
    const logs = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(['log', ...args]));
    const spyInfo = jest.spyOn(console, 'info').mockImplementation((...args) => logs.push(['info', ...args]));
    const spyWarn = jest.spyOn(console, 'warn').mockImplementation((...args) => logs.push(['warn', ...args]));
    const spyErr = jest.spyOn(console, 'error').mockImplementation((...args) => logs.push(['error', ...args]));
    const log = createLogger('t', 'warn');
    log.debug('a'); // below level
    log.info('b');  // below level
    log.warn('c');
    log.error('d');
    expect(logs.some(l => l[0] === 'warn')).toBe(true);
    expect(logs.some(l => l[0] === 'error')).toBe(true);
    expect(logs.some(l => l[0] === 'info')).toBe(false);
    expect(logs.some(l => l[0] === 'log')).toBe(false);
    spy.mockRestore(); spyInfo.mockRestore(); spyWarn.mockRestore(); spyErr.mockRestore();
  });
});
