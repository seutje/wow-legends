import Game from '../src/js/game.js';

describe('Benediction', () => {
  test('draws only after healing 5 or more in a turn', async () => {
    const g = new Game();
    await g.setupMatch();
    g.resources._pool.set(g.player, 10);
    const initialHand = g.player.hand.cards.length;
    g.addCardToHand('equipment-benediction');
    await g.playFromHand(g.player, 'equipment-benediction');
    expect(g.player.hand.cards.length).toBe(initialHand);

    g.player.hero.data.maxHealth = 30;
    g.player.hero.data.health = 25;

    await g.effects.healCharacter({ target: 'hero', amount: 3 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(initialHand);

    await g.effects.healCharacter({ target: 'hero', amount: 2 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(initialHand + 1);

    await g.effects.healCharacter({ target: 'hero', amount: 1 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(initialHand + 1);

    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();
    g.resources.startTurn(g.player);
    g.player.hero.data.health = 25;
    const handAtTurnStart = g.player.hand.cards.length;

    await g.effects.healCharacter({ target: 'hero', amount: 5 }, { game: g, player: g.player, card: null });
    expect(g.player.hand.cards.length).toBe(handAtTurnStart + 1);
  });
});
