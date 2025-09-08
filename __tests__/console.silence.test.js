import { jest } from '@jest/globals';

describe('console output', () => {
  test('console.log does not write to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write');
    console.log('hidden');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
