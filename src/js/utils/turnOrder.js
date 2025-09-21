// Helpers for choosing turn order using the shared RNG utilities.

/**
 * Determine which side should take the first turn.
 * When a seedable RNG is supplied the result is deterministic and
 * therefore reproducible for seeded matches. Falls back to Math.random
 * when no RNG is available (e.g., browser quick play).
 *
 * @param {object} [rng]
 * @returns {'player'|'opponent'}
 */
export function chooseStartingPlayerKey(rng) {
  if (rng && typeof rng.randomInt === 'function') {
    return rng.randomInt(0, 2) === 0 ? 'player' : 'opponent';
  }
  return Math.random() < 0.5 ? 'player' : 'opponent';
}

export default chooseStartingPlayerKey;
