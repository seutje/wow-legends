import { evaluateCounterfactualDecision, positionFingerprint } from '../src/js/systems/ai-counterfactual.js';
import { fileURLToPath } from 'node:url';
import { WIN_CONDITION_BONUS } from '../src/js/systems/ai-heuristics.js';
import { runMatch } from '../tools/agent-evaluation.mjs';
import { analyzeCounterfactualRun, parseCounterfactualArgs } from '../tools/analyze-counterfactuals.mjs';

const attackAgent = { id: 'jev', async chooseAction(_state, actions) { return actions.find(action => action.attack) || actions.find(action => action.end); } };
const endAgent = { id: 'jev', async chooseAction(_state, actions) { return actions.find(action => action.end); } };
const powerAgent = { id: 'jev', async chooseAction(_state, actions) { return actions.find(action => action.usePower && !action.card) || actions.find(action => action.end); } };

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
    expect(result.candidates[0]).toMatchObject({ estimatedValue: WIN_CONDITION_BONUS, immediateLethal: true,
      runs: [{ terminal: true, outcome: 'win' }] });
    expect(result.candidates[0].classification).toMatchObject({ primary: 'attack-face', tags: expect.arrayContaining(['face-pressure']) });
    expect(result.candidates[0].immediateEffects.opponentHeroDamageImmediate).toBeGreaterThan(0);
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

  test('armor prevents an otherwise lethal attack and analysis does not mutate the snapshot', async () => {
    const event = await lethalEvent(); event.analysisSnapshot.opponent.hero.data.armor = 10;
    event.decisionInput.state.opponent.hero.armor = 10;
    const before = JSON.stringify(event.analysisSnapshot);
    const result = await evaluateCounterfactualDecision({ event, config: { iterations: 3, rolloutDepth: 1, baseSeed: 2 } });
    expect(result.candidates[0].immediateLethal).toBe(false);
    expect(JSON.stringify(event.analysisSnapshot)).toBe(before);
  });

  test('records actionable resources when Jev ends its turn', async () => {
    const match = await runMatch({ agentA: endAgent, agentB: 'basic', maxTurns: 1, seed: 44,
      configureGame(game) {
        game.resources._pool.set(game.player, 10);
        const ally = game.player.hand.cards.find(card => card.type === 'ally');
        const attacker = structuredClone(ally); attacker.instanceId = 'diagnostic-attacker';
        attacker.data = { ...attacker.data, attack: 2, health: 2, summoningSick: false,
          attacked: false, attacksUsed: 0, enteredTurn: game.turns.turn - 1 };
        game.player.battlefield.add(attacker);
      } });
    const event = match.decisionEvents[0];
    event.neuralComparison = { topActionId: event.legalActions.find(action => action.type !== 'end-turn').id };
    const result = await evaluateCounterfactualDecision({ event, config: { iterations: 3, rolloutDepth: 1, baseSeed: 2 } });
    expect(result.sequencing).toMatchObject({ hadRemainingMana: true, hadPlayableCard: true,
      hadAvailableAttack: true, hadHeroPowerAvailable: true });
    expect(result.sequencing.nonEndLegalActionCount).toBeGreaterThan(0);
  });

  test('records a legitimate end turn with no remaining legal action', async () => {
    const match = await runMatch({ agentA: endAgent, agentB: 'basic', maxTurns: 1, seed: 45,
      configureGame(game) {
        game.player.hand.cards = []; game.player.battlefield.cards = [];
        game.player.hero.powerUsed = true; game.player.hero.data.attack = 0;
        game.resources._pool.set(game.player, 0);
      } });
    const result = await evaluateCounterfactualDecision({ event: match.decisionEvents[0],
      config: { iterations: 2, rolloutDepth: 1, baseSeed: 2 } });
    expect(result.sequencing).toMatchObject({ nonEndLegalActionCount: 0, hadPlayableCard: false,
      hadAvailableAttack: false, hadHeroPowerAvailable: false });
  });

  test('records standalone hero-power sequencing alternatives', async () => {
    const match = await runMatch({ agentA: powerAgent, agentB: 'basic', maxTurns: 1, seed: 46,
      configureGame(game) { game.resources._pool.set(game.player, 10); } });
    const event = match.decisionEvents[0];
    const combined = event.legalActions.find(action => action.type === 'play-card-and-hero-power');
    const alternative = combined || event.legalActions.find(action => action.type === 'play-card');
    event.neuralComparison = { topActionId: alternative.id };
    const result = await evaluateCounterfactualDecision({ event,
      config: { iterations: 2, rolloutDepth: 1, baseSeed: 2 } });
    expect(result.sequencing).toMatchObject({ playableCardsRemaining: expect.any(Number),
      legalAttacksRemaining: expect.any(Number), combinedCardAndHeroPowerActionsAvailable: expect.any(Number),
      remainingManaAfterHeroPower: 8, neuralAlternativeClass: expect.any(String) });
    expect(result.sequencing.playableCardsRemaining).toBeGreaterThan(0);
  });

  test('same seed is reproducible and repeats start from the same recorded state', async () => {
    const event = await lethalEvent();
    const config = { iterations: 5, rolloutDepth: 2, repeats: 2, baseSeed: 12 };
    const first = await evaluateCounterfactualDecision({ event, config });
    const second = await evaluateCounterfactualDecision({ event, config });
    expect(second.candidates).toEqual(first.candidates);
    expect(new Set(first.candidates[0].runs.map(run => run.seed)).size).toBe(2);
    expect(first.candidates[0]).toEqual(expect.objectContaining({ distinctRepeatValues: expect.any(Number),
      repeatRange: expect.any(Number) }));
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
