import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';
import { deriveDeckFromGame } from '../src/js/utils/deckstate.js';

function selectDeckFromPool(pool, rng, { excludeHeroIds = [] } = {}) {
  const source = Array.isArray(pool) ? pool : [];
  if (!source.length) return null;
  const exclude = new Set((excludeHeroIds || []).filter(Boolean));
  const filtered = source.filter((deck) => deck?.hero?.id && !exclude.has(deck.hero.id));
  const candidates = filtered.length ? filtered : source.filter((deck) => deck?.hero?.id);
  if (!candidates.length) return null;
  const index = rng.randomInt(0, candidates.length);
  const selected = candidates[index];
  if (!selected) return null;
  return {
    name: selected.name || null,
    hero: selected.hero || null,
    cards: Array.isArray(selected.cards) ? selected.cards.slice() : [],
  };
}

describe('Random deck selection seeding', () => {
  test('hero and deck remain stable after ending turn with seeded random selection', async () => {
    const game = new Game(null, { aiPlayers: ['opponent'] });
    await game.init();

    const decks = await game.getPrebuiltDecks();
    expect(Array.isArray(decks) && decks.length).toBeTruthy();
    expect(decks.length).toBeGreaterThan(1);

    const seed = 0xBEEFCAFE;
    const rng = new RNG(seed);
    const playerDeck = selectDeckFromPool(decks, rng);
    expect(playerDeck?.hero?.id).toBeTruthy();
    const opponentDeck = selectDeckFromPool(decks, rng, { excludeHeroIds: [playerDeck.hero.id] });
    expect(opponentDeck?.hero?.id).toBeTruthy();

    game.rng.seed(seed);
    await game.reset({
      hero: playerDeck.hero,
      cards: playerDeck.cards,
      opponentHeroId: opponentDeck.hero.id,
      opponentDeck,
    });

    const before = deriveDeckFromGame(game);
    expect(before.hero?.id).toBe(playerDeck.hero.id);

    await game.endTurn();

    expect(game.player.hero?.id).toBe(playerDeck.hero.id);
    const after = deriveDeckFromGame(game);
    expect(after.hero?.id).toBe(before.hero?.id);

    const sortIds = (cards) => (Array.isArray(cards) ? cards.map((card) => card.id).sort() : []);
    expect(sortIds(after.cards)).toEqual(sortIds(before.cards));
  });
});
