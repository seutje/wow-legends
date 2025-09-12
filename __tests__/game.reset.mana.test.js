import Game from '../src/js/game.js';

describe('Game.reset', () => {
  test('resets turn and mana pool', async () => {
    const g = new Game(null);
    await g.init();
    g.turns.turn = 5;
    g.resources.startTurn(g.player);
    expect(g.resources.pool(g.player)).toBe(5);
    await g.reset();
    expect(g.turns.turn).toBe(1);
    expect(g.resources.pool(g.player)).toBe(1);
  });
});
