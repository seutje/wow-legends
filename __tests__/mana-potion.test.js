import Game from '../src/js/game.js';

describe('Mana Potion', () => {
  test('restores 2 resources when at least 2 spent', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.resources.pay(g.player, 2);
    g.addCardToHand('consumable-mana-potion');
    await g.playFromHand(g.player, 'consumable-mana-potion');
    expect(g.resources.pool(g.player)).toBe(10);
    expect(g.resources._overloadNext.get(g.player)).toBe(1);
  });

  test('does not restore if less than 2 spent', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.resources.pay(g.player, 1);
    g.addCardToHand('consumable-mana-potion');
    await g.playFromHand(g.player, 'consumable-mana-potion');
    expect(g.resources.pool(g.player)).toBe(9);
    expect(g.resources._overloadNext.get(g.player)).toBe(1);
  });
});

