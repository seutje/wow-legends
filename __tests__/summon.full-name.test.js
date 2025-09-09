import Game from '../src/js/game.js';

describe('summoned unit names', () => {
  test('summoned allies display full name', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];

    g.addCardToHand('spell-summon-infernal');
    await g.playFromHand(g.player, 'spell-summon-infernal');

    const summoned = g.player.battlefield.cards.find(c => c.name === 'Infernal');
    expect(summoned).toBeTruthy();
    expect(summoned.name).toBe('Infernal');
    expect(summoned.name.length).toBeGreaterThan(1);
  });
});
