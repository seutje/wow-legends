import { deriveDeckFromGame } from '../src/js/utils/deckstate.js';

describe('deriveDeckFromGame', () => {
  test('collects hero and 60 cards from zones, ignoring tokens', () => {
    const hero = { id: 'hero-1', type: 'hero', name: 'H' };
    const allCards = [hero];
    const mk = (i) => ({ id: `c-${i}`, type: 'ally', name: `C${i}` });
    for (let i = 0; i < 70; i++) allCards.push(mk(i));
    const tokens = [{ id: 'token-x', type: 'ally', name: 'T', summonedBy: { id: 'spell-y' } }];
    const lib = allCards.slice(1, 31).map(c => ({ id: c.id, type: c.type }));
    const hand = allCards.slice(31, 41).map(c => ({ id: c.id, type: c.type }));
    const gy = allCards.slice(41, 56).map(c => ({ id: c.id, type: c.type }));
    const bf = [allCards[56], allCards[57]].map(c => ({ id: c.id, type: c.type }));
    const rem = [allCards[58], allCards[59], allCards[60]].map(c => ({ id: c.id, type: c.type }));
    const game = {
      allCards,
      player: {
        hero: { id: hero.id },
        library: { cards: lib },
        hand: { cards: hand },
        battlefield: { cards: [...bf, ...tokens] },
        graveyard: { cards: gy },
        removed: { cards: rem },
      }
    };
    const deck = deriveDeckFromGame(game);
    expect(deck.hero).toBe(hero);
    expect(deck.cards).toHaveLength(60);
    expect(deck.cards[0].id).toBe('c-0');
    expect(deck.cards.some(c => c.id === 'token-x')).toBe(false);
  });
});
