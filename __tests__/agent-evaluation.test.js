import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMatch, runMirroredPair, runSeries, writeEvaluationResults } from '../tools/agent-evaluation.mjs';
import { parseOptions, validateRemoteOptions } from '../tools/evaluate-agents.mjs';
import { MockDecisionClient } from '../src/js/systems/ai-remote.js';

const basic = { id: 'test-basic', async chooseAction(_state, actions) {
  return actions.find(action => action.attack) || actions.find(action => action.end);
} };

describe('agent evaluation', () => {
  test('runs both sides, records a winner, seed, start position and decisions', async () => {
    const match = await runMatch({ agentA: 'basic', agentB: 'basic', seed: 3 });
    expect(match.status).toBe('completed');
    expect(['A', 'B', 'draw']).toContain(match.winner);
    expect(match.seed).toBe(3);
    expect(match.startingPlayer).toBe('A');
    expect(match.decisions.A).toBeGreaterThan(0);
    expect(match.decisions.B).toBeGreaterThan(0);
    const event = match.decisionEvents[0];
    expect(event.selectedActionSignature).toEqual(expect.any(String));
    expect(event.description).toEqual(expect.any(String));
    expect(event.latencyMs).toEqual(expect.any(Number));
    expect(event.decisionInput.state.opponent.hand).toBeUndefined();
    expect(event.decisionInput.actions).toHaveLength(event.legalActionCount);
    expect(event.legalActions[0].signature).toEqual(expect.any(String));
  });

  test('mirrors the starting side with the same seed and aggregates games', async () => {
    const pair = await runMirroredPair({ agentA: 'basic', agentB: 'basic', seed: 11, maxTurns: 2 });
    expect(pair.map(game => game.startingPlayer)).toEqual(['A', 'B']);
    expect(pair.map(game => game.seed)).toEqual([11, 11]);
    const series = await runSeries({ agentA: 'basic', agentB: 'basic', games: 2, baseSeed: 3 });
    expect(series.completedGames).toBe(2);
    expect(series.agents.A.wins + series.agents.B.wins + series.agents.A.draws).toBe(2);
    expect(series.config.informationMode).toBe('player');
    expect(JSON.parse(JSON.stringify(series)).games).toHaveLength(2);
  });

  test('captures remote probabilities, protects secrets, and leaves neural comparison advisory', async () => {
    const fakeKey = 'sk-test-secret-12345';
    const client = new MockDecisionClient({ decide: async payload => ({
      actionId: payload.actions.find(action => action.type === 'end-turn').id,
      metadata: { provider: 'openrouter', model: '~typesafe/jev-latest',
        probabilities: Object.fromEntries(payload.actions.map(action => [action.id, action.type === 'end-turn' ? 1 : 0])),
        requestId: fakeKey, apiKey: fakeKey, usage: { input_tokens: 10 }, },
    }) });
    client.apiKey = fakeKey;
    const evaluator = { evaluate: (_state, actions) => ({ policy: new Map(actions.map((action, index) => [
      // This deliberately disagrees with the mock's end-turn selection.
      action.end ? 'end-turn' : `other-${index}`, action.end ? 0 : 1,
    ])) }) };
    const result = await runMatch({ agentA: 'jev', agentB: basic, client, neuralEvaluator: evaluator,
      compareNeural: true, maxTurns: 2, seed: 5,
      configureGame: game => game.resources._pool.set(game.player, 10) });
    expect(result.status).toBe('limit');
    const remoteEvent = result.decisionEvents.find(event => event.agent === 'jev');
    expect(remoteEvent.selectedActionType).toBe('end-turn');
    expect(remoteEvent.metadata.probabilities[remoteEvent.selectedActionId]).toBe(1);
    expect(remoteEvent.metadata.usage.input_tokens).toBe(10);
    expect(remoteEvent.neuralComparison).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(fakeKey);
    expect(JSON.stringify(result)).not.toContain('apiKey');
    const directory = await mkdtemp(join(tmpdir(), 'wow-evaluation-'));
    try {
      const paths = await writeEvaluationResults({ games: [result] }, directory, 'test');
      expect(await readFile(paths.summaryPath, 'utf8')).not.toContain(fakeKey);
      expect(await readFile(paths.decisionsPath, 'utf8')).not.toContain(fakeKey);
      expect((await readFile(paths.decisionsPath, 'utf8')).trim().split('\n').length).toBe(result.decisionEvents.length);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('records remote errors without awarding a win or exposing error text', async () => {
    const fakeKey = 'sk-test-secret-12345';
    const client = { apiKey: fakeKey, async decide() { throw new Error(fakeKey); } };
    const result = await runMatch({ agentA: 'jev', agentB: basic, client, maxTurns: 2,
      configureGame: game => game.resources._pool.set(game.player, 10) });
    expect(result.status).toBe('error');
    expect(result.errorType).toBe('remote-decision-failed');
    expect(result.winner).toBeNull();
    expect(JSON.stringify(result)).not.toContain(fakeKey);
  });

  test('remote choices repeat across a turn; sampled MCTS advice does not replace them', async () => {
    const client = new MockDecisionClient({ strategy: 'first' });
    const result = await runMatch({ agentA: 'jev', agentB: basic, client, seed: 3,
      maxTurns: 8, compareMctsEvery: 1, mctsIterations: 5, rolloutDepth: 2 });
    expect(result.status).toBe('limit');
    expect(result.decisions.A).toBeGreaterThan(1);
    expect(result.decisionEvents.filter(event => event.agent === 'jev')
      .every(event => event.mctsComparison?.topActionId)).toBe(true);
  });

  test('seeded local matches reproduce outcomes and semantic action traces', async () => {
    const first = await runMatch({ agentA: 'basic', agentB: 'basic', seed: 3 });
    const second = await runMatch({ agentA: 'basic', agentB: 'basic', seed: 3 });
    expect(second.winner).toBe(first.winner);
    expect(second.turns).toBe(first.turns);
    expect(second.decisionEvents.map(event => event.description))
      .toEqual(first.decisionEvents.map(event => event.description));
  });

  test('CLI prevents unapproved or oversized remote series', () => {
    const options = parseOptions(['--agent-a', 'jev', '--agent-b', 'basic', '--games', '2']);
    expect(() => validateRemoteOptions(options, {})).toThrow('both --allow-remote');
    options.allowRemote = true;
    expect(() => validateRemoteOptions(options, {})).toThrow('both --allow-remote');
    expect(validateRemoteOptions(options, { ALLOW_REMOTE_EVALUATION: '1' })).toBe(true);
    options.games = 4;
    expect(() => validateRemoteOptions(options, { ALLOW_REMOTE_EVALUATION: '1' })).toThrow('limited to 2');
  });
});
