import Game from '../src/js/game.js';

describe('Environment sanity', () => {
  test('ESM imports work', () => {
    expect(typeof Game).toBe('function');
  });

  test('Game can construct and lifecycle methods exist', () => {
    const g = new Game(null);
    expect(g).toBeTruthy();
    expect(typeof g.init).toBe('function');
    expect(typeof g.start).toBe('function');
    expect(typeof g.update).toBe('function');
    expect(typeof g.reset).toBe('function');
    expect(typeof g.dispose).toBe('function');
  });
});

