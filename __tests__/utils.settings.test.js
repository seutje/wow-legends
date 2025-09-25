/** @jest-environment jsdom */

import { loadSettings, saveDifficulty, saveLastDeck, rehydrateDeck } from '../src/js/utils/settings.js';

const SETTINGS_KEY = 'wow-legends:settings';

describe('Settings persistence', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.clear === 'function') {
      localStorage.clear();
    }
  });

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

  test('migrates legacy hybrid difficulty to insane', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ settings: { difficulty: 'hybrid' } }));

    const settings = loadSettings();
    expect(settings.difficulty).toBe('insane');

    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    expect(stored.settings.difficulty).toBe('insane');
  });
});
