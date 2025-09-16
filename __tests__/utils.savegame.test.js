import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
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

  test('secrets persist across save and restore', async () => {
    const game = new Game(null);
    await game.init();

    const secretCard = new Card({
      id: 'spell-test-explosive-trap',
      name: 'Explosive Trap',
      type: 'spell',
      effects: [{ type: 'explosiveTrap', amount: 2 }],
    });

    // Simulate the secret being played this match.
    game.player.graveyard.cards.push(secretCard);
    game.effects.explosiveTrap(secretCard.effects[0], {
      game,
      player: game.player,
      card: secretCard,
    });

    expect(Array.isArray(game.player.hero.data.secrets)).toBe(true);
    expect(game.player.hero.data.secrets).toHaveLength(1);

    const snapshot = captureGameState(game);
    const clone = new Game(null);
    await clone.init();
    const ok = restoreCapturedState(clone, snapshot);
    expect(ok).toBe(true);

    const secrets = clone.player.hero.data.secrets;
    expect(Array.isArray(secrets)).toBe(true);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].type).toBe('explosiveTrap');
    expect(secrets[0].cardId).toBe(secretCard.id);
  });
});
