import SaveSystem from '../systems/save.js';
import { normalizeDifficulty } from './difficulty.js';

const SETTINGS_KEY = 'settings';
let _saveInstance = null;
function getSave() {
  if (_saveInstance) return _saveInstance;
  _saveInstance = new SaveSystem({ version: 1 });
  return _saveInstance;
}

export function loadSettings() {
  const save = getSave();
  const raw = save.storage.getItem(save.key(SETTINGS_KEY));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const settings = parsed?.settings || {};
    const out = {};
    let migrated = false;
    if (typeof settings.difficulty === 'string') {
      const normalized = normalizeDifficulty(settings.difficulty);
      out.difficulty = normalized;
      if (normalized !== settings.difficulty) {
        parsed.settings = { ...settings, difficulty: normalized };
        migrated = true;
      }
    }
    if (settings.lastDeck && typeof settings.lastDeck === 'object') {
      out.lastDeck = settings.lastDeck;
    }
    if (migrated) {
      save.storage.setItem(save.key(SETTINGS_KEY), JSON.stringify(parsed));
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDifficulty(difficulty) {
  const save = getSave();
  const cur = loadSettings();
  const normalized = normalizeDifficulty(difficulty);
  const next = { settings: { ...cur, difficulty: normalized } };
  save.storage.setItem(save.key(SETTINGS_KEY), JSON.stringify(next));
}

export function saveLastDeck(deck) {
  // Deck: { hero, cards } where hero and cards are full card data objects
  if (!deck?.hero || !Array.isArray(deck.cards)) return false;
  const payload = {
    heroId: deck.hero.id,
    cardIds: deck.cards.map(c => c.id)
  };
  const save = getSave();
  const cur = loadSettings();
  const next = { settings: { ...cur, lastDeck: payload } };
  save.storage.setItem(save.key(SETTINGS_KEY), JSON.stringify(next));
  return true;
}

export function rehydrateDeck(saved, allCards) {
  if (!saved || !allCards?.length) return null;
  const hero = allCards.find(c => c.id === saved.heroId && c.type === 'hero');
  if (!hero) return null;
  const cards = [];
  for (const id of saved.cardIds || []) {
    const found = allCards.find(c => c.id === id && c.type !== 'hero');
    if (!found) return null;
    cards.push(found);
  }
  if (cards.length !== 60) return null;
  return { hero, cards };
}
