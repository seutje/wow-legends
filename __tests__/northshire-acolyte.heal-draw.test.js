import Game from '../src/js/game.js';

describe('Northshire Acolyte', () => {
  test('draws when a friendly character is healed', async () => {
    const g = new Game();
    await g.setupMatch();
    g.resources._pool.set(g.player, 10);
    const initialHand = g.player.hand.cards.length;
    g.addCardToHand('ally-northshire-acolyte');
    await g.playFromHand(g.player, 'ally-northshire-acolyte');
    expect(g.player.hand.cards.length).toBe(initialHand);

    await g.effects.healCharacter({ target: 'hero', amount: 1 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(initialHand + 1);

    await g.effects.healCharacter({ target: 'hero', amount: 1 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(initialHand + 1);

    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();
    g.resources.startTurn(g.player);
    const handBeforeHeal = g.player.hand.cards.length;
    await g.effects.healCharacter({ target: 'hero', amount: 1 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(handBeforeHeal + 1);
  });
});
