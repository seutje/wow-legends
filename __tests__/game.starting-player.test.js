import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';

async function setupWithSeed(seed) {
  const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
  game.state.difficulty = 'easy';
  game.rng = new RNG(seed);
  await game.setupMatch();
  return game;
}

describe('starting player selection', () => {
  test('uses deterministic value for identical seeds', async () => {
    const first = await setupWithSeed(1234);
    const second = await setupWithSeed(1234);
    expect(second.state.startingPlayer).toBe(first.state.startingPlayer);
  });

  test('varies across different seeds', async () => {
    const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
    const results = [];
    for (const seed of seeds) {
      const game = await setupWithSeed(seed);
      results.push(game.state.startingPlayer);
    }
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  test('active player aligns with stored startingPlayer', async () => {
    const game = await setupWithSeed(3456);
    const key = game.state.startingPlayer;
    expect(key === 'player' || key === 'opponent').toBe(true);
    const expected = key === 'player' ? game.player : game.opponent;
    expect(game.turns.activePlayer).toBe(expected);
  });

  test('player gains only two resources on second turn when opponent starts', async () => {
    const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
    game.state.difficulty = 'easy';
    game.rng = new RNG(1);
    await game.setupMatch();
    expect(game.state.startingPlayer).toBe('opponent');
    expect(game.turns.turn).toBe(1);
    expect(game.resources.pool(game.player)).toBe(1);

    await game.endTurn();

    expect(game.turns.turn).toBe(2);
    expect(game.resources.pool(game.player)).toBe(2);
  });

  test('opponent reaches three resources on third turn when starting first', async () => {
    const game = new Game(null, { aiPlayers: ['opponent'] });
    game.state.difficulty = 'easy';
    game.rng = new RNG(4);
    const originalStartTurn = game.resources.startTurn;
    const observed = [];
    game.resources.startTurn = function patchedStartTurn(player) {
      const result = originalStartTurn.call(this, player);
      if (player === game.opponent) observed.push(this.pool(player));
      return result;
    };

    try {
      await game.setupMatch();
      expect(game.state.startingPlayer).toBe('opponent');
      expect(observed[0]).toBe(1);

      await game.endTurn();
      expect(observed[1]).toBe(2);

      await game.endTurn();
      expect(observed[2]).toBe(3);
    } finally {
      game.resources.startTurn = originalStartTurn;
    }
  });
});
