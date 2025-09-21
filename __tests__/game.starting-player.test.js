import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';

async function setupWithSeed(seed) {
  const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
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
});
