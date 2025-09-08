import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

describe('hero effects', () => {
  test('passive effect triggers at start of each turn', async () => {
    const g = new Game();
    g.player.hero = new Hero({ passive: [{ type: 'buff', target: 'hero', property: 'armor', amount: 1 }] });
    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();
    await Promise.resolve();
    expect(g.player.hero.data.armor).toBe(1);

    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    expect(g.player.hero.data.armor).toBe(2);
  });

  test('active effect can be used once per turn', async () => {
    const g = new Game();
    g.player.hero = new Hero({ active: [{ type: 'buff', target: 'hero', property: 'armor', amount: 1 }] });
    g.turns.setActivePlayer(g.player);
    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();

    await g.useHeroPower(g.player);
    expect(g.player.hero.data.armor).toBe(1);
    await g.useHeroPower(g.player);
    expect(g.player.hero.data.armor).toBe(1);

    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    await g.useHeroPower(g.player);
    expect(g.player.hero.data.armor).toBe(2);
  });
});

