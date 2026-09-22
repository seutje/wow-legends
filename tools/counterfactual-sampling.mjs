import { RNG } from '../src/js/utils/rng.js';

export const SAMPLING_STRATEGIES = Object.freeze(['chronological', 'random', 'stratified']);
const identity = event => `${event.matchId}\u0000${event.decisionIndex}`;

function shuffled(values, rng) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = rng.randomInt(0, index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function takeWithCap(events, limit, maxPerMatch) {
  const counts = new Map(); const selected = [];
  for (const event of events) {
    if (selected.length >= limit) break;
    const count = counts.get(event.matchId) || 0;
    if (count >= maxPerMatch) continue;
    selected.push(event); counts.set(event.matchId, count + 1);
  }
  return selected;
}

export function sampleCounterfactualPositions(eligible, { strategy = 'stratified', seed = 1,
  limit = 10, maxPerMatch = Infinity, manifest = null } = {}) {
  if (!SAMPLING_STRATEGIES.includes(strategy)) throw new RangeError(`Unknown sampling strategy: ${strategy}`);
  if (!Number.isInteger(seed) || seed < 0 || !(limit === Infinity || Number.isInteger(limit) && limit >= 0)
    || !(maxPerMatch === Infinity || Number.isInteger(maxPerMatch) && maxPerMatch >= 1)) {
    throw new RangeError('Invalid sampling configuration');
  }
  const unique = [...new Map(eligible.map(event => [identity(event), event])).values()];
  const effectiveLimit = Math.min(limit, unique.length);
  let selected;
  if (manifest) {
    const wanted = new Map(manifest.map(item => [`${item.matchId}\u0000${item.decisionIndex}`, item]));
    selected = takeWithCap(unique.filter(event => {
      const item = wanted.get(identity(event));
      return item && (!item.positionFingerprint || item.positionFingerprint === event.positionFingerprint);
    }), effectiveLimit, maxPerMatch);
  } else if (strategy === 'chronological') {
    selected = takeWithCap(unique, effectiveLimit, maxPerMatch);
  } else if (strategy === 'random') {
    selected = takeWithCap(shuffled(unique, new RNG(seed)), effectiveLimit, maxPerMatch);
  } else {
    const grouped = new Map();
    for (const event of unique) {
      if (!grouped.has(event.matchId)) grouped.set(event.matchId, []);
      grouped.get(event.matchId).push(event);
    }
    const rng = new RNG(seed);
    const groups = shuffled([...grouped.entries()], rng).map(([matchId, events]) => ({
      matchId, events: shuffled(events, rng), taken: 0,
    }));
    selected = [];
    let added = true;
    while (selected.length < effectiveLimit && added) {
      added = false;
      for (const group of groups) {
        if (selected.length >= effectiveLimit) break;
        if (group.taken >= maxPerMatch || group.taken >= group.events.length) continue;
        selected.push(group.events[group.taken++]); added = true;
      }
    }
  }
  const actionTypes = {};
  for (const event of selected) {
    const type = event.selectedActionType || 'unknown';
    actionTypes[type] = (actionTypes[type] || 0) + 1;
  }
  return { selected, metadata: { strategy, seed,
    requestedLimit: limit === Infinity ? null : limit,
    selectedPositions: selected.length,
    maxPerMatch: maxPerMatch === Infinity ? null : maxPerMatch,
    eligiblePositions: unique.length,
    eligibleMatches: new Set(unique.map(event => event.matchId)).size,
    sampledMatches: new Set(selected.map(event => event.matchId)).size,
    actionTypes } };
}

export function createSampleManifest(selected, sampling) {
  return { schemaVersion: 1, manifestType: 'counterfactual-position-sample', sampling,
    positions: selected.map(event => ({ matchId: event.matchId, decisionIndex: event.decisionIndex,
      positionFingerprint: event.positionFingerprint || null, selectedActionType: event.selectedActionType || 'unknown' })) };
}
