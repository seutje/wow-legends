import Game from '../src/js/game.js';

describe('Game.reset', () => {
  test('clears lingering end-of-turn effects', async () => {
    const g = new Game();
    await g.setupMatch();
    const baseline = g.effects.cleanupFns.size;

    g.resources._pool.set(g.player, 10);
    const originalPick = g.rng.pick.bind(g.rng);

    g.addCardToHand('ally-argent-healer');
    await g.playFromHand(g.player, 'ally-argent-healer');

    expect(g.effects.cleanupFns.size).toBeGreaterThan(baseline);

    await g.reset();

    expect(g.effects.cleanupFns.size).toBe(baseline);

    g.rng.pick = (arr) => arr[arr.length - 1];

    g.player.hero.data.maxHealth = 30;
    g.player.hero.data.health = 10;

    const before = g.player.hero.data.health;
    g.turns.bus.emit('turn:start', { player: g.opponent });
    expect(g.player.hero.data.health).toBe(before);

    g.rng.pick = originalPick;
  });
});
