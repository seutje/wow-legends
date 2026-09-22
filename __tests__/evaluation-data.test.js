import { readFile } from 'node:fs/promises';
import { actionRows, aggregateComparisons, decisionAgreement, EvaluationDataError,
  jensenShannonDivergence, normalizeEvaluationRun, parseDecisionJsonl, parseEvaluationJson,
  probabilityComparison, sanitizeForDisplay, counterfactualSummary,
  normalizeCounterfactualCollection } from '../src/js/evaluation/data.js';

const fixture = async name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('evaluation data loader', () => {
  test('loads a summary and JSONL decisions including failed games', async () => {
    const summary = parseEvaluationJson(await fixture('evaluation-run.json'));
    const events = parseDecisionJsonl(await fixture('evaluation-decisions.jsonl'));
    const run = normalizeEvaluationRun(summary, events);
    expect(run.schemaVersion).toBe(1);
    expect(run.games).toHaveLength(2);
    expect(run.games[0].decisionEvents).toHaveLength(2);
    expect(run.games[1].status).toBe('error');
  });

  test('supports embedded decisions and missing optional model metrics', () => {
    const event = { matchId: 'm', selectedActionId: 'a0' };
    const run = normalizeEvaluationRun({ games: [{ matchId: 'm', status: 'completed', decisionEvents: [event] }] });
    expect(run.legacy).toBe(true);
    expect(run.decisionEvents[0].metadata).toBeUndefined();
    expect(actionRows(run.decisionEvents[0])).toEqual([]);
  });

  test('reports malformed JSON, malformed JSONL, empty runs and unsupported schemas', () => {
    expect(() => parseEvaluationJson('{')).toThrow('Malformed evaluation JSON');
    expect(() => parseDecisionJsonl('{}\nnope')).toThrow('line 2');
    expect(() => normalizeEvaluationRun({ schemaVersion: 2, games: [{}] })).toThrow('Unsupported');
    expect(() => normalizeEvaluationRun({ schemaVersion: 1, games: [] })).toThrow('no games');
  });

  test('redacts secret-shaped fields recursively and bearer values', () => {
    const clean = sanitizeForDisplay({ state: { apiKey: 'secret', Authorization: 'Bearer secret', safe: 'ok' }, headers: { x: 1 } });
    expect(clean).toEqual({ state: { apiKey: '[redacted]', Authorization: '[redacted]', safe: 'ok' }, headers: '[redacted]' });
    expect(JSON.stringify(clean)).not.toContain('secret');
  });
});

describe('counterfactual analysis data', () => {
  test('validates and aggregates neutral threshold classifications', () => {
    const analyses = [{ matchId: 'm1', selectedActionType: 'attack', candidates: [
      { selectedBy: ['jev'], estimatedValue: 0.4 }, { selectedBy: ['neural'], estimatedValue: 0.2 },
    ] }, { matchId: 'm2', selectedActionType: 'end-turn', candidates: [
      { selectedBy: ['jev'], estimatedValue: 0.21 }, { selectedBy: ['neural'], estimatedValue: 0.2 },
    ] }];
    const raw = { schemaVersion: 1, analysisType: 'counterfactual-mcts-collection', analyses };
    expect(normalizeCounterfactualCollection(raw).analyses).toHaveLength(2);
    expect(normalizeCounterfactualCollection({ ...raw, schemaVersion: 2,
      diagnostics: { tacticalPairs: [] } }).diagnostics).toEqual({ tacticalPairs: [] });
    expect(counterfactualSummary(analyses, 0.05)).toMatchObject({ positionsAnalyzed: 2, jevHigher: 1, approximatelyTied: 1, neuralHigher: 0 });
    expect(() => normalizeCounterfactualCollection({ schemaVersion: 2 })).toThrow('Unsupported');
  });
});

describe('evaluation comparisons', () => {
  const event = { agent: 'jev', selectedActionId: 'a0', selectedActionType: 'attack',
    metadata: { probabilities: { a0: 0.8, a1: 0.2 } },
    neuralComparison: { topActionId: 'a1', policy: { a0: 0.25, a1: 0.75 } },
    decisionInput: { actions: [
      { id: 'a0', signature: 'attack-one', description: 'Attack one', type: 'attack' },
      { id: 'a1', signature: 'attack-two', description: 'Attack two', type: 'attack' },
    ] } };

  test('aligns by action ID and detects agreement or disagreement', () => {
    expect(decisionAgreement(event)).toBe(false);
    expect(decisionAgreement({ ...event, neuralComparison: { ...event.neuralComparison, topActionId: 'a0' } })).toBe(true);
    const rows = actionRows(event);
    expect(rows[0]).toMatchObject({ id: 'a0', signature: 'attack-one', selectedByJev: true, neuralProbability: 0.25 });
    expect(rows[1].selectedByNeural).toBe(true);
  });

  test('calculates cross-probabilities, gaps and safe Jensen-Shannon divergence', () => {
    const comparison = probabilityComparison(event);
    expect(comparison).toMatchObject({ jevChoice: { jev: 0.8, neural: 0.25 }, neuralChoice: { jev: 0.2, neural: 0.75 } });
    expect(comparison.topChoiceGap).toBeCloseTo(0.6);
    expect(jensenShannonDivergence(event)).toBeGreaterThan(0);
    const zeros = { ...event, metadata: { probabilities: { a0: 1, a1: 0 } }, neuralComparison: { topActionId: 'a1', policy: { a0: 0, a1: 1 } } };
    expect(jensenShannonDivergence(zeros)).toBeCloseTo(1);
    expect(jensenShannonDivergence({ ...event, metadata: {} })).toBeNull();
  });

  test('aggregates agreement by action type', () => {
    const result = aggregateComparisons([event, { ...event, selectedActionId: 'a1' }]);
    expect(result).toMatchObject({ compared: 2, agreements: 1, disagreements: 1 });
    expect(result.actionTypes.attack).toMatchObject({ compared: 2, agreements: 1 });
  });
});
