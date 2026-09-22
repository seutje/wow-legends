import { evaluateCounterfactualDecision, positionFingerprint } from '../src/js/systems/ai-counterfactual.js';
import { fileURLToPath } from 'node:url';
import { runMatch } from '../tools/agent-evaluation.mjs';
import { analyzeCounterfactualRun, parseCounterfactualArgs } from '../tools/analyze-counterfactuals.mjs';

const attackAgent = { id: 'jev', async chooseAction(_state, actions) { return actions.find(action => action.attack) || actions.find(action => action.end); } };

async function lethalEvent() {
  const match = await runMatch({ agentA: attackAgent, agentB: 'basic', maxTurns: 1, seed: 71,
    configureGame(game) {
      game.opponent.hero.data.health = 1;
      const ally = game.player.hand.cards.find(card => card.type === 'ally');
      game.player.hand.remove(ally); game.player.battlefield.add(ally);
      ally.data.attack = Math.max(1, ally.data.attack || 1); ally.data.summoningSick = false;
      ally.data.attacked = false; ally.data.attacksUsed = 0; ally.data.enteredTurn = game.turns.turn - 1;
    } });
  return match.decisionEvents[0];
}

describe('counterfactual MCTS analysis', () => {
  test('evaluates immediate lethal favorably from the original active player perspective', async () => {
    const event = await lethalEvent(); const before = JSON.stringify(event.analysisSnapshot);
    const result = await evaluateCounterfactualDecision({ event, config: { iterations: 5, rolloutDepth: 2, repeats: 1, baseSeed: 9 } });
    expect(result.evaluator.informationMode).toBe('perfect');
    expect(result.evaluator.policyGuidance).toBe('none');
    expect(result.candidates[0]).toMatchObject({ estimatedValue: 1000, runs: [{ terminal: true, outcome: 'win' }] });
    expect(JSON.stringify(event.analysisSnapshot)).toBe(before);
  });

  test('deduplicates shared selections and preserves all selecting agents', async () => {
    const event = await lethalEvent();
    event.neuralComparison = { topActionId: event.selectedActionId };
    const alternate = event.legalActions.find(action => action.id !== event.selectedActionId);
    event.mctsComparison = { topActionId: alternate.id };
    const result = await evaluateCounterfactualDecision({ event, config: { iterations: 5, rolloutDepth: 2, repeats: 1, baseSeed: 4 } });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find(candidate => candidate.actionId === event.selectedActionId).selectedBy).toEqual(['jev', 'neural']);
  });

  test('same seed is reproducible and repeats start from the same recorded state', async () => {
    const event = await lethalEvent();
    const config = { iterations: 5, rolloutDepth: 2, repeats: 2, baseSeed: 12 };
    const first = await evaluateCounterfactualDecision({ event, config });
    const second = await evaluateCounterfactualDecision({ event, config });
    expect(second.candidates).toEqual(first.candidates);
    expect(positionFingerprint(event.analysisSnapshot)).toBe(first.positionFingerprint);
  });

  test('rejects a reconstructed position whose legal signatures differ', async () => {
    const event = await lethalEvent(); event.legalActions[0].signature = 'different';
    await expect(evaluateCounterfactualDecision({ event, config: { iterations: 2, rolloutDepth: 1 } }))
      .rejects.toThrow('do not match');
  });

  test('CLI defaults constrain batch size and exhaustive analysis is explicit', () => {
    const options = parseCounterfactualArgs(['--input', 'run.json', '--disagreements-only']);
    expect(options.limit).toBe(10); expect(options.candidateMode).toBe('selected-agents-only');
    expect(options.sampling).toBe('stratified'); expect(options.samplingSeed).toBe(1);
    expect(parseCounterfactualArgs(['--input', 'run.json', '--all-actions']).candidateMode).toBe('all');
    expect(parseCounterfactualArgs(['--input', 'run.json', '--sampling', 'chronological', '--sampling-seed', '9',
      '--max-per-match', '3', '--action-types', 'attack,end-turn', '--dry-run']))
      .toMatchObject({ sampling: 'chronological', samplingSeed: 9, maxPerMatch: 3,
        actionTypes: ['attack', 'end-turn'], dryRun: true });
  });

  test('dry run filters before sampling and does not require engine snapshots', async () => {
    const input = fileURLToPath(new URL('./fixtures/evaluation-run.json', import.meta.url));
    const decisions = fileURLToPath(new URL('./fixtures/evaluation-decisions.jsonl', import.meta.url));
    const result = await analyzeCounterfactualRun(parseCounterfactualArgs(['--input', input,
      '--decisions', decisions, '--disagreements-only', '--action-type', 'play-card', '--dry-run']));
    expect(result.sampling).toMatchObject({ eligiblePositions: 1, selectedPositions: 1, sampledMatches: 1 });
    expect(result.positions[0]).toMatchObject({ matchId: 'match-1', decisionIndex: 0, selectedActionType: 'play-card' });
  });
});
