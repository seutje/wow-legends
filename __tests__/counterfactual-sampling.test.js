import { createSampleManifest, sampleCounterfactualPositions } from '../tools/counterfactual-sampling.mjs';

const event = (matchId, decisionIndex, selectedActionType = 'attack') => ({
  matchId, decisionIndex, positionFingerprint: `${matchId}-${decisionIndex}`, selectedActionType,
});
const fixture = () => [
  ...Array.from({ length: 100 }, (_, index) => event('A', index, index % 2 ? 'attack' : 'end-turn')),
  ...Array.from({ length: 2 }, (_, index) => event('B', index, 'play-card')),
  ...Array.from({ length: 2 }, (_, index) => event('C', index, 'hero-power')),
  ...Array.from({ length: 2 }, (_, index) => event('D', index, 'attack')),
];
const ids = result => result.selected.map(item => `${item.matchId}:${item.decisionIndex}`);

describe('counterfactual position sampling', () => {
  test('chronological preserves eligible ordering and respects limit', () => {
    const input = fixture(); const result = sampleCounterfactualPositions(input, { strategy: 'chronological', limit: 4 });
    expect(ids(result)).toEqual(['A:0', 'A:1', 'A:2', 'A:3']);
    expect(result.metadata).toMatchObject({ eligiblePositions: 106, eligibleMatches: 4, selectedPositions: 4, sampledMatches: 1 });
  });

  test('stratified round robin represents imbalanced matches fairly', () => {
    const input = fixture();
    const four = sampleCounterfactualPositions(input, { strategy: 'stratified', seed: 12, limit: 4 });
    expect(new Set(four.selected.map(item => item.matchId))).toEqual(new Set(['A', 'B', 'C', 'D']));
    const eight = sampleCounterfactualPositions(input, { strategy: 'stratified', seed: 12, limit: 8 });
    expect(Object.fromEntries(['A', 'B', 'C', 'D'].map(match => [match,
      eight.selected.filter(item => item.matchId === match).length]))).toEqual({ A: 2, B: 2, C: 2, D: 2 });
  });

  test('same seed repeats, another seed changes selection, and duplicates are removed', () => {
    const input = [...fixture(), event('A', 0)];
    const first = sampleCounterfactualPositions(input, { strategy: 'random', seed: 3, limit: 12 });
    const repeated = sampleCounterfactualPositions(input, { strategy: 'random', seed: 3, limit: 12 });
    const changed = sampleCounterfactualPositions(input, { strategy: 'random', seed: 4, limit: 12 });
    expect(ids(repeated)).toEqual(ids(first)); expect(ids(changed)).not.toEqual(ids(first));
    expect(new Set(ids(first)).size).toBe(first.selected.length);
    expect(ids(first)).not.toEqual(input.slice(0, 12).map(item => `${item.matchId}:${item.decisionIndex}`));
  });

  test('per-match cap is respected and an unfillable limit is reported', () => {
    const result = sampleCounterfactualPositions(fixture(), { strategy: 'stratified', seed: 1, limit: 20, maxPerMatch: 2 });
    expect(result.selected).toHaveLength(8);
    for (const match of ['A', 'B', 'C', 'D']) expect(result.selected.filter(item => item.matchId === match)).toHaveLength(2);
    expect(result.metadata).toMatchObject({ requestedLimit: 20, selectedPositions: 8, maxPerMatch: 2, sampledMatches: 4 });
  });

  test('metadata reports action distribution and manifests reproduce identities', () => {
    const sampled = sampleCounterfactualPositions(fixture(), { strategy: 'stratified', seed: 9, limit: 7, maxPerMatch: 2 });
    expect(Object.values(sampled.metadata.actionTypes).reduce((sum, count) => sum + count, 0)).toBe(7);
    const manifest = createSampleManifest(sampled.selected, sampled.metadata);
    const replayed = sampleCounterfactualPositions(fixture(), { strategy: 'random', seed: 99, limit: Infinity,
      manifest: manifest.positions });
    expect(new Set(ids(replayed))).toEqual(new Set(ids(sampled)));
  });
});
