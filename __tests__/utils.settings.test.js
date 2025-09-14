import { loadSettings, saveDifficulty, saveLastDeck, rehydrateDeck } from '../src/js/utils/settings.js';

describe('Settings persistence', () => {
  test('saves and loads difficulty', () => {
    // Start clean
    const before = loadSettings();
    expect(before.difficulty).toBeUndefined();
    saveDifficulty('hard');
    const after = loadSettings();
    expect(after.difficulty).toBe('hard');
  });

  test('saves last deck as ids and rehydrates', () => {
    const hero = { id: 'hero-valeera-the-hollow', type: 'hero', name: 'Valeera' };
    const pool = Array.from({ length: 80 }, (_, i) => ({ id: `card-${i}`, type: 'ally', name: `C${i}` }));
    const cards = pool.slice(0, 60);
    const allCards = [hero, ...pool];
    const ok = saveLastDeck({ hero, cards });
    expect(ok).toBe(true);
    const settings = loadSettings();
    expect(settings.lastDeck).toBeTruthy();
    expect(settings.lastDeck.heroId).toBe(hero.id);
    expect(settings.lastDeck.cardIds).toHaveLength(60);
    const deck = rehydrateDeck(settings.lastDeck, allCards);
    expect(deck).toBeTruthy();
    expect(deck.hero.id).toBe(hero.id);
    expect(deck.cards).toHaveLength(60);
    expect(deck.cards[0].id).toBe(cards[0].id);
  });
});

