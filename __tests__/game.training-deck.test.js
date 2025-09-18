import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';

describe('training decks', () => {
  function expectDeckToRespectLimits(cards) {
    expect(Array.isArray(cards)).toBe(true);
    expect(cards).toHaveLength(60);

    const counts = new Map();
    const equipmentIds = new Set();
    let allyCount = 0;

    for (const card of cards) {
      expect(card).toBeTruthy();
      const prev = counts.get(card.id) || 0;
      const next = prev + 1;
      counts.set(card.id, next);
      expect(next).toBeLessThanOrEqual(3);
      if (card.type === 'ally') allyCount += 1;
      if (card.type === 'equipment') equipmentIds.add(card.id);
      expect(card.type).not.toBe('quest');
    }

    expect(allyCount).toBeGreaterThanOrEqual(30);
    expect(equipmentIds.size).toBeLessThanOrEqual(1);
  }

  it('use deckbuilder random fill limits for AI training decks', async () => {
    const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
    game.rng = new RNG(1234);
    await game.setupMatch();

    expect(game.player.hero).toBeTruthy();
    expect(game.opponent.hero).toBeTruthy();
    const playerDeckCards = [...game.player.library.cards, ...game.player.hand.cards];
    const opponentDeckCards = [...game.opponent.library.cards, ...game.opponent.hand.cards];
    expectDeckToRespectLimits(playerDeckCards);
    expectDeckToRespectLimits(opponentDeckCards);
  });
});
