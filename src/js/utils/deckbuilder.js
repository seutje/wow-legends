import { RNG, pick as defaultPick } from './rng.js';

// Fills the provided deck state with a random hero (if missing)
// and random non-hero cards until it has exactly 60 cards.
// Uses provided RNG if available for determinism; falls back to default helpers.
export function fillDeckRandomly(state, allCards, rng = null) {
  if (!state || !allCards) return state;
  const pick = rng instanceof RNG ? (arr) => rng.pick(arr) : (arr) => defaultPick(arr);

  const heroes = allCards.filter(c => c.type === 'hero');
  const nonHeroes = allCards.filter(c => c.type !== 'hero');
  if (!state.hero) {
    if (heroes.length === 0) return state;
    state.hero = pick(heroes);
  }
  while (state.cards.length < 60 && nonHeroes.length > 0) {
    state.cards.push(pick(nonHeroes));
  }
  if (state.cards.length > 60) state.cards.length = 60;
  return state;
}

