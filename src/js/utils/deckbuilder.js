import { RNG, pick as defaultPick } from './rng.js';

// Fills the provided deck state with a random hero (if missing)
// and random non-hero cards until it has exactly 60 cards.
// Uses provided RNG if available for determinism; falls back to default helpers.
export function fillDeckRandomly(state, allCards, rng = null) {
  if (!state || !allCards) return state;
  const pick = rng instanceof RNG ? (arr) => rng.pick(arr) : (arr) => defaultPick(arr);

  const heroes = allCards.filter(c => c.type === 'hero');
  const quests = allCards.filter(c => c.type === 'quest');
  const others = allCards.filter(c => c.type !== 'hero' && c.type !== 'quest');

  if (!state.hero) {
    if (heroes.length === 0) return state;
    state.hero = pick(heroes);
  }

  // ensure at most one quest is present in the deck state
  let questSeen = false;
  for (let i = state.cards.length - 1; i >= 0; i--) {
    const card = state.cards[i];
    if (card.type === 'quest') {
      if (questSeen) state.cards.splice(i, 1);
      else questSeen = true;
    }
  }

  while (state.cards.length < 60) {
    const pool = questSeen ? others : others.concat(quests);
    if (pool.length === 0) break;
    const card = pick(pool);
    state.cards.push(card);
    if (card.type === 'quest') questSeen = true;
  }

  if (state.cards.length > 60) state.cards.length = 60;
  return state;
}

