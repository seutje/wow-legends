import Deck from '../src/js/entities/deck.js';
import { RNG } from '../src/js/utils/rng.js';

describe('Deck.shuffle', () => {
  it('uses provided RNG instances for deterministic shuffles', () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({ id: `card-${i}` }));
    const deckA = new Deck();
    deckA.cards = cards.map(card => ({ ...card }));
    const deckB = new Deck();
    deckB.cards = cards.map(card => ({ ...card }));

    const seed = 0x1A2B3C4D;
    const rngA = new RNG(seed);
    const rngB = new RNG(seed);

    deckA.shuffle(rngA);
    deckB.shuffle(rngB);

    expect(deckA.cards.map(c => c.id)).toEqual(deckB.cards.map(c => c.id));
  });
});
