import { RNG, pick as defaultPick } from './rng.js';

// Fills the provided deck state with a random hero (if missing)
// and random non-hero cards until it has exactly 60 cards.
// Uses provided RNG if available for determinism; falls back to default helpers.
export function fillDeckRandomly(state, allCards, rng = null) {
  if (!state || !allCards) return state;
  const pick = rng instanceof RNG ? (arr) => rng.pick(arr) : (arr) => defaultPick(arr);

  const heroes = allCards.filter(c => c.type === 'hero');
  if (!state.hero) {
    if (heroes.length === 0) return state;
    state.hero = pick(heroes);
  }

  if (!Array.isArray(state.cards)) state.cards = [];

  const counts = new Map();
  let equipmentId = null;
  const sanitized = [];

  for (const card of state.cards) {
    if (!card || card.type === 'quest') continue;
    if (card.type === 'equipment') {
      if (!equipmentId) equipmentId = card.id;
      if (card.id !== equipmentId) continue;
    }
    const current = counts.get(card.id) || 0;
    if (current >= 3) continue;
    counts.set(card.id, current + 1);
    sanitized.push(card);
  }

  state.cards = sanitized;
  let allyCount = sanitized.filter(c => c.type === 'ally').length;

  const removeCardAt = (index) => {
    if (index < 0 || index >= state.cards.length) return null;
    const [removed] = state.cards.splice(index, 1);
    if (!removed) return null;
    const current = counts.get(removed.id) || 0;
    if (current <= 1) counts.delete(removed.id);
    else counts.set(removed.id, current - 1);
    if (removed.type === 'ally') allyCount = Math.max(0, allyCount - 1);
    if (removed.type === 'equipment' && !counts.has(removed.id)) equipmentId = null;
    return removed;
  };

  const requiredAllies = Math.max(0, 30 - allyCount);
  const spaceAvailable = 60 - state.cards.length;
  let neededSlots = requiredAllies - spaceAvailable;
  if (neededSlots < 0) neededSlots = 0;

  if (neededSlots > 0) {
    for (let i = state.cards.length - 1; i >= 0 && neededSlots > 0; i--) {
      const card = state.cards[i];
      if (card && card.type !== 'ally') {
        removeCardAt(i);
        neededSlots -= 1;
      }
    }
  }

  const allyCards = allCards.filter(c => c.type === 'ally');
  const nonQuestCards = allCards.filter(c => c.type !== 'hero' && c.type !== 'quest');

  const canAdd = (card) => {
    if (!card || card.type === 'quest' || card.type === 'hero') return false;
    const current = counts.get(card.id) || 0;
    if (current >= 3) return false;
    if (card.type === 'equipment') {
      if (equipmentId && card.id !== equipmentId) return false;
    }
    return true;
  };

  const addCard = (card) => {
    state.cards.push(card);
    counts.set(card.id, (counts.get(card.id) || 0) + 1);
    if (card.type === 'equipment' && !equipmentId) equipmentId = card.id;
    if (card.type === 'ally') allyCount += 1;
  };

  const pickEligible = (pool) => {
    const eligible = pool.filter(canAdd);
    if (eligible.length === 0) return null;
    return pick(eligible);
  };

  while (allyCount < 30 && state.cards.length < 60) {
    const card = pickEligible(allyCards);
    if (!card) break;
    addCard(card);
  }

  while (state.cards.length < 60) {
    const card = pickEligible(nonQuestCards);
    if (!card) break;
    addCard(card);
  }

  while (state.cards.length > 60) {
    let indexToRemove = state.cards.findIndex(c => c && c.type !== 'ally');
    if (indexToRemove === -1) indexToRemove = state.cards.length - 1;
    removeCardAt(indexToRemove);
  }

  return state;
}

