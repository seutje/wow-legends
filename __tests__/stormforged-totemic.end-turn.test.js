import Game from '../src/js/game.js';

describe('Stormforged Totemic', () => {
  test('buffs a random friendly ally at end of turn', async () => {
    const g = new Game();
    await g.setupMatch();
    g.resources._pool.set(g.player, 10);
    // Make RNG deterministic
    g.rng.pick = arr => arr[0];

    // Ensure we can observe the buff clearly
    g.addCardToHand('ally-stormforged-totemic');
    await g.playFromHand(g.player, 'ally-stormforged-totemic');

    const totem = g.player.battlefield.cards.find(c => c.id === 'ally-stormforged-totemic');
    expect(totem).toBeTruthy();
    expect(totem.data.attack).toBe(0);

    // At start of controller's turn: no trigger
    g.turns.bus.emit('turn:start', { player: g.player });
    expect(totem.data.attack).toBe(0);

    // At start of opponent's turn (end of controller's): buff applies
    g.turns.bus.emit('turn:start', { player: g.opponent });
    expect(totem.data.attack).toBe(1);
  });
});

