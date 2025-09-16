import Game from '../src/js/game.js';
import { captureGameState, restoreCapturedState } from '../src/js/utils/savegame.js';

describe('savegame utilities', () => {
  test('capture and restore round trip', async () => {
    const game = new Game(null);
    await game.init();

    // Modify some state to ensure it survives round-trip
    game.player.hero.data.health -= 3;
    game.state.debug = true;
    game.turns.turn = 3;
    game.turns.current = 'Main';
    game.resources._pool.set(game.player, 2);
    game.player.log.push('Test entry');

    const snapshot = captureGameState(game);
    expect(snapshot).toBeTruthy();

    const clone = new Game(null);
    await clone.init();
    const ok = restoreCapturedState(clone, snapshot);
    expect(ok).toBe(true);
    expect(clone.player.hero.data.health).toBe(game.player.hero.data.health);
    expect(clone.player.log.slice(-1)[0]).toBe('Test entry');
    expect(clone.turns.turn).toBe(3);
    expect(clone.turns.current).toBe('Main');
    expect(clone.resources.pool(clone.player)).toBe(2);
    expect(clone.state.debug).toBe(true);
  });
});
