import Game from '../src/js/game.js';

describe('Imp Swarm Caller deathrattle', () => {
  test('triggers only when Imp Swarm Caller dies', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];

    g.addCardToHand('ally-imp-swarm-caller');
    await g.playFromHand(g.player, 'ally-imp-swarm-caller');

    expect(g.player.battlefield.cards.filter(c => c.name === 'Imp').length).toBe(0);

    const caller = g.player.battlefield.cards.find(c => c.name === 'Imp Swarm Caller');
    caller.data.health = 0;
    caller.data.dead = true;
    await g.cleanupDeaths(g.player, g.opponent);

    expect(g.player.battlefield.cards.filter(c => c.name === 'Imp').length).toBe(2);

    const imp = g.player.battlefield.cards.find(c => c.name === 'Imp');
    imp.data.health = 0;
    imp.data.dead = true;
    await g.cleanupDeaths(g.player, g.opponent);

    expect(g.player.battlefield.cards.filter(c => c.name === 'Imp').length).toBe(1);
  });
});
