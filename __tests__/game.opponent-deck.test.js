import Game from '../src/js/game.js';

describe('Game opponent deck selection', () => {
  test('reset uses supplied opponent deck when provided', async () => {
    const game = new Game(null);
    await game.init();

    const prebuiltDecks = await game.getPrebuiltDecks();
    expect(prebuiltDecks.length).toBeGreaterThan(1);

    const playerDeck = prebuiltDecks[0];
    const opponentDeck = prebuiltDecks.find((deck) => deck?.hero?.id !== playerDeck?.hero?.id) || prebuiltDecks[1];

    const deckOverride = {
      hero: playerDeck.hero,
      cards: Array.isArray(playerDeck.cards) ? playerDeck.cards.slice() : [],
      opponentDeck: {
        hero: opponentDeck.hero,
        cards: Array.isArray(opponentDeck.cards) ? opponentDeck.cards.slice() : [],
      },
    };

    await game.reset(deckOverride);

    expect(game.player.hero.id).toBe(playerDeck.hero.id);
    expect(game.opponent.hero.id).toBe(opponentDeck.hero.id);

    const countById = (cards) => {
      const counts = new Map();
      for (const card of cards) {
        if (!card?.id) continue;
        counts.set(card.id, (counts.get(card.id) || 0) + 1);
      }
      return counts;
    };

    const playerExpected = countById(playerDeck.cards);
    const playerAllCards = [...game.player.library.cards, ...game.player.hand.cards];
    const playerActual = countById(playerAllCards);
    expect(playerAllCards).toHaveLength(60);
    expect(playerAllCards.every((card) => !!card?.id)).toBe(true);
    for (const [id, count] of playerActual) {
      expect(playerExpected.has(id)).toBe(true);
      expect(count).toBeLessThanOrEqual(playerExpected.get(id));
    }

    const opponentExpected = countById(opponentDeck.cards);
    const opponentAllCards = [...game.opponent.library.cards, ...game.opponent.hand.cards];
    const opponentActual = countById(opponentAllCards);
    expect(opponentAllCards).toHaveLength(60);
    expect(opponentAllCards.every((card) => !!card?.id)).toBe(true);
    for (const [id, count] of opponentActual) {
      expect(opponentExpected.has(id)).toBe(true);
      expect(count).toBeLessThanOrEqual(opponentExpected.get(id));
    }

    expect(game.state.lastOpponentHeroId).toBe(opponentDeck.hero.id);
  });
});
