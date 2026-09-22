import Game from '../game.js';
import MCTS_AI from './ai-mcts.js';
import { createDecisionState, getLegalActions } from './ai-actions.js';
import { actionSignature } from './ai-signatures.js';
import { restoreCapturedState } from '../utils/savegame.js';
import { WIN_CONDITION_BONUS } from './ai-heuristics.js';
import { RNG } from '../utils/rng.js';

export const COUNTERFACTUAL_SCHEMA_VERSION = 1;
export const COUNTERFACTUAL_EVALUATOR_VERSION = 1;

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['startedAt', 'frame', 'aiProgress', 'aiPending', 'aiThinking'].includes(key))
    .map(key => [key, stable(value[key])]));
};

export function positionFingerprint(snapshot) {
  const text = JSON.stringify(stable(snapshot));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hashText(text) {
  let hash = 2166136261;
  for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function seeded(seed, callback) {
  const rng = new RNG(seed); const original = Math.random;
  Math.random = () => rng.random();
  return Promise.resolve().then(callback).finally(() => { Math.random = original; });
}

function currentState(game) {
  const player = game.turns.activePlayer;
  const opponent = player === game.player ? game.opponent : game.player;
  const pool = game.resources.pool(player);
  return createDecisionState({ player, opponent, pool, turn: game.turns.turn,
    powerAvailable: !player.hero?.powerUsed, game });
}

function candidateSelections(event, mode, additionalActionIds = []) {
  const selected = new Map();
  const add = (id, source) => {
    if (!id) return;
    if (!selected.has(id)) selected.set(id, new Set());
    if (source) selected.get(id).add(source);
  };
  add(event.selectedActionId, event.agent || 'recorded-agent');
  add(event.neuralComparison?.topActionId, 'neural');
  add(event.mctsComparison?.topActionId, 'mcts');
  additionalActionIds.forEach(id => add(id, 'additional'));
  if (mode === 'all') (event.legalActions || event.decisionInput?.actions || []).forEach(action => add(action.id, null));
  return selected;
}

function stats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return { estimatedValue: mean, minEstimatedValue: Math.min(...values),
    maxEstimatedValue: Math.max(...values), stdDev: Math.sqrt(variance) };
}

export async function evaluateCounterfactualDecision({ event, config = {}, progress = null } = {}) {
  if (!event?.analysisSnapshot) throw new Error('Counterfactual analysis requires an engine snapshot');
  const iterations = config.iterations ?? 1000;
  const rolloutDepth = config.rolloutDepth ?? 10;
  const repeats = config.repeats ?? 1;
  const baseSeed = config.baseSeed ?? 1;
  const fullSim = !!config.fullSim;
  const candidateMode = config.candidateMode || 'selected-agents-only';
  if (!Number.isInteger(iterations) || iterations < 1 || !Number.isInteger(rolloutDepth) || rolloutDepth < 1
    || !Number.isInteger(repeats) || repeats < 1 || !Number.isInteger(baseSeed)
    || !['selected-agents-only', 'all'].includes(candidateMode)) throw new RangeError('Invalid counterfactual configuration');
  const game = new Game(null, { seed: baseSeed, aiPlayers: ['player', 'opponent'], aiActionDelayMs: 0 });
  if (!restoreCapturedState(game, structuredClone(event.analysisSnapshot))) throw new Error('Could not restore recorded engine position');
  const state = currentState(game);
  const actions = getLegalActions(state);
  const actual = actions.map(actionSignature);
  const recorded = (event.legalActions || []).map(action => action.signature);
  if (recorded.length && (recorded.length !== actual.length || recorded.some((signature, index) => signature !== actual[index]))) {
    throw new Error('Reconstructed legal actions do not match recorded position');
  }
  const selections = candidateSelections(event, candidateMode, config.additionalActionIds || []);
  const candidates = [];
  for (const [actionId, sources] of selections) {
    const actionIndex = Number(actionId.slice(1));
    const action = actions[actionIndex];
    if (!action || `a${actionIndex}` !== actionId) throw new Error(`Recorded candidate ${actionId} is not legal`);
    const signature = actionSignature(action);
    const descriptor = (event.legalActions || event.decisionInput?.actions || [])[actionIndex] || {};
    const runs = [];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const seed = (baseSeed + hashText(signature) + repeat) >>> 0;
      const mcts = new MCTS_AI({ game, resourceSystem: game.resources, combatSystem: game.combat,
        iterations, rolloutDepth, fullSim, policyValueModel: null });
      const candidateAction = { ...action, ...(action.attack ? { attack: { ...action.attack } } : {}) };
      const rootInput = fullSim ? mcts._buildSimFrom(game, state.player, state.opponent) : state;
      const outcome = fullSim ? await mcts._applyActionSim(rootInput, candidateAction)
        : mcts._applyAction(rootInput, candidateAction);
      const playerHealth = outcome.state?.player?.hero?.data?.health;
      const opponentHealth = outcome.state?.opponent?.hero?.data?.health;
      let estimatedValue; let terminal = false; let outcomeLabel = null; let rootVisits = 0;
      if (opponentHealth != null && opponentHealth <= 0) {
        terminal = true; outcomeLabel = 'win'; estimatedValue = WIN_CONDITION_BONUS;
      } else if (playerHealth != null && playerHealth <= 0) {
        terminal = true; outcomeLabel = 'loss'; estimatedValue = -WIN_CONDITION_BONUS;
      } else if (outcome.terminal) {
        terminal = true; outcomeLabel = outcome.lethal ? 'win' : 'evaluated-terminal'; estimatedValue = outcome.value;
      } else {
        await seeded(seed, () => fullSim ? mcts._searchFullSimAsync(outcome.state) : mcts._searchAsync(outcome.state));
        const root = mcts._lastTree?.node;
        rootVisits = root?.visits || 0;
        estimatedValue = rootVisits ? root.total / rootVisits : fullSim
          ? (await mcts._resolveCombatAndScoreSim(outcome.state)).value : mcts._heuristicRolloutValue(outcome.state);
      }
      runs.push({ seed, estimatedValue, terminal, ...(outcomeLabel ? { outcome: outcomeLabel } : {}), rootVisits });
    }
    candidates.push({ actionId, actionSignature: signature, description: descriptor.description || actionId,
      selectedBy: [...sources], ...stats(runs.map(run => run.estimatedValue)), runs });
    progress?.({ completed: candidates.length, total: selections.size, actionId });
  }
  return { schemaVersion: COUNTERFACTUAL_SCHEMA_VERSION, analysisType: 'counterfactual-mcts',
    evaluatorVersion: COUNTERFACTUAL_EVALUATOR_VERSION, matchId: event.matchId,
    decisionIndex: event.decisionIndex, positionFingerprint: positionFingerprint(event.analysisSnapshot),
    originalPlayer: event.playerId, selectedActionType: event.selectedActionType,
    evaluator: { type: 'mcts', iterations, rolloutDepth,
      fullSim, policyGuidance: 'none', informationMode: 'perfect', repeats, baseSeed,
      valueScale: `heuristic; terminal win/loss = +/-${WIN_CONDITION_BONUS}` }, candidates };
}

export function counterfactualCacheKey(event, config, actionSignatureValue = '') {
  return [COUNTERFACTUAL_EVALUATOR_VERSION, event.matchId, event.decisionIndex,
    positionFingerprint(event.analysisSnapshot), actionSignatureValue, config.iterations,
    config.rolloutDepth, !!config.fullSim, config.repeats, config.baseSeed].join('|');
}
