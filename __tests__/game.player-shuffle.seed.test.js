import Game from '../src/js/game.js';
import Deck from '../src/js/entities/deck.js';
import { RNG } from '../src/js/utils/rng.js';
import { deriveDeckFromGame } from '../src/js/utils/deckstate.js';

function canonicalize(cards) {
  return cards
    .map((card, index) => ({ card: { ...card }, index }))
    .sort((a, b) => {
      const idA = typeof a.card?.id === 'string' ? a.card.id : '';
      const idB = typeof b.card?.id === 'string' ? b.card.id : '';
      if (idA === idB) return a.index - b.index;
      return idA.localeCompare(idB, undefined, { numeric: true });
    })
    .map((entry) => entry.card);
}

describe('Game player shuffle', () => {
  test('uses match seed for player library order', async () => {
    const baseSeed = 0x12345678;
    const game = new Game(null, { aiPlayers: ['opponent'] });

    // Load card data once so we can build a controlled deck list
    await game.setupMatch();
    const hero = game.allCards.find((card) => card.type === 'hero');
    expect(hero).toBeTruthy();
    const nonQuestCards = game.allCards.filter((card) => card.type !== 'hero' && card.type !== 'quest');
    expect(nonQuestCards.length).toBeGreaterThanOrEqual(60);
    const deckCards = nonQuestCards.slice(0, 60);

    // Reseed the RNG and consume some values to simulate earlier random usage
    game.rng = new RNG(baseSeed);
    game.rng.randomInt(0, 1000);
    game.rng.randomInt(0, 1000);

    await game.reset({ hero, cards: deckCards });

    const handOrder = game.player.hand.cards.map((card) => card.id);
    const libraryOrder = game.player.library.cards.map((card) => card.id).reverse();
    const playerOrder = [...handOrder, ...libraryOrder];
    expect(playerOrder).toHaveLength(60);

    const expectedDeck = new Deck();
    expectedDeck.cards = canonicalize(deckCards);
    expectedDeck.shuffle(new RNG(baseSeed));
    const expectedOrder = expectedDeck.cards.map((card) => card.id).reverse();

    expect(playerOrder).toEqual(expectedOrder);
  });

  test('restarting with same seed yields identical opening hand', async () => {
    const baseSeed = 9876;
    const game = new Game(null, { aiPlayers: ['opponent'] });

    await game.setupMatch();
    const hero = game.allCards.find((card) => card.type === 'hero');
    const nonQuestCards = game.allCards.filter((card) => card.type !== 'hero' && card.type !== 'quest');
    const deckCards = nonQuestCards.slice(0, 60);

    game.rng = new RNG(baseSeed);
    await game.reset({ hero, cards: deckCards });

    const firstHand = game.player.hand.cards.map((card) => card.id);

    const derivedDeck = deriveDeckFromGame(game);
    game.rng.seed(baseSeed);
    await game.reset(derivedDeck);

    const secondHand = game.player.hand.cards.map((card) => card.id);
    expect(secondHand).toEqual(firstHand);
  });
});
