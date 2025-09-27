import Game from '../src/js/game.js';
import { fillDeckRandomly } from '../src/js/utils/deckbuilder.js';

function buildDeckForHero(game, hero) {
  const state = { hero, cards: [] };
  fillDeckRandomly(state, game.allCards, game.rng);
  return { hero: state.hero, cards: Array.isArray(state.cards) ? state.cards.slice() : [] };
}

describe('Game.setupMatch opponent deck override', () => {
  test('uses provided opponent deck hero and cards', async () => {
    const game = new Game(null);
    await game.init();
    const heroes = game.allCards.filter((card) => card?.type === 'hero');
    expect(heroes.length).toBeGreaterThan(1);

    const prebuiltDecks = await game.getPrebuiltDecks();
    expect(prebuiltDecks.length).toBeGreaterThan(0);
    const opponentTemplate = prebuiltDecks.find((deck) => deck?.hero && deck.cards?.length === 60);
    expect(opponentTemplate).toBeTruthy();

    const playerHero = heroes.find((hero) => hero.id !== opponentTemplate.hero.id) || heroes[0];
    const playerDeck = buildDeckForHero(game, playerHero);
    const opponentDeck = {
      hero: opponentTemplate.hero,
      cards: opponentTemplate.cards.slice(),
    };
    playerDeck.opponentDeck = opponentDeck;

    await game.reset(playerDeck);

    expect(game.opponent.hero?.id).toBe(opponentDeck.hero.id);
    const opponentLibraryIds = game.opponent.library.cards.map((card) => card.id);
    const expectedIds = opponentDeck.cards.map((card) => card.id);
    expect(new Set(opponentLibraryIds)).toEqual(new Set(expectedIds));
  });
});
