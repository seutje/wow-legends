import Game from '../game.js';
import MCTS_AI from './ai-mcts.js';
import { createDecisionState, getLegalActions } from './ai-actions.js';
import { actionSignature } from './ai-signatures.js';
import { restoreCapturedState } from '../utils/savegame.js';
import { NON_TERMINAL_VALUE_MAX, NON_TERMINAL_VALUE_MIN, WIN_CONDITION_BONUS } from './ai-heuristics.js';
import { RNG } from '../utils/rng.js';
import { classifyAction, primaryStrategicCategory } from './ai-action-classification.js';

export const COUNTERFACTUAL_SCHEMA_VERSION = 2;
export const COUNTERFACTUAL_EVALUATOR_VERSION = 2;

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

function seededSync(seed, callback) {
  const rng = new RNG(seed); const original = Math.random;
  Math.random = () => rng.random();
  try { return callback(); } finally { Math.random = original; }
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

export function clampCounterfactualValue(value) {
  return Math.max(NON_TERMINAL_VALUE_MIN, Math.min(NON_TERMINAL_VALUE_MAX, value));
}

const livingAllies = player => (player?.battlefield?.cards || []).filter(card => card?.type === 'ally' && !card.data?.dead && (card.data?.health ?? 0) > 0);
const boardAttack = player => livingAllies(player).reduce((sum, card) => sum + Math.max(0, card.data?.attack ?? card.attack ?? 0), 0);
const heroHealth = player => player?.hero?.data?.health ?? null;

function immediateMetrics(before, after) {
  if (!after) return null;
  const enemyBefore = livingAllies(before.opponent); const enemyAfter = livingAllies(after.opponent);
  return {
    opponentHeroDamageImmediate: heroHealth(before.opponent) == null || heroHealth(after.opponent) == null ? null
      : Math.max(0, heroHealth(before.opponent) - heroHealth(after.opponent)),
    ownHeroHealthDelta: heroHealth(before.player) == null || heroHealth(after.player) == null ? null
      : heroHealth(after.player) - heroHealth(before.player),
    enemyMinionsRemoved: Math.max(0, enemyBefore.length - enemyAfter.length),
    enemyBoardAttackDelta: Math.max(0, boardAttack(before.opponent) - boardAttack(after.opponent)),
    friendlyBoardAttackDelta: boardAttack(after.player) - boardAttack(before.player),
  };
}

function sequencingDiagnostics(event, state, actions) {
  const classes = actions.map(action => classifyAction(action, state));
  const nonEnd = actions.map((action, index) => ({ action, classification: classes[index] })).filter(item => !item.action.end);
  const resources = event.decisionInput?.state?.player?.resources || {};
  const result = { remainingMana: state.pool, maximumMana: resources.maximum ?? null,
    handSize: state.player?.hand?.cards?.length ?? null,
    boardSlotsRemaining: Math.max(0, 5 - (state.player?.battlefield?.cards?.filter(card => card.type === 'ally').length || 0)),
    nonEndLegalActionCount: nonEnd.length, remainingActionTypes: [...new Set(nonEnd.map(item => item.classification.primary))],
    remainingActionClasses: [...new Set(nonEnd.flatMap(item => item.classification.tags || []))],
    hadRemainingMana: state.pool > 0, hadPlayableCard: nonEnd.some(item => !!item.action.card),
    hadAvailableAttack: nonEnd.some(item => !!item.action.attack),
    hadHeroPowerAvailable: nonEnd.some(item => item.action.usePower && !item.action.card) };
  if (event.selectedActionType === 'hero-power') {
    const powerCost = state.game?._evaluateFirstHealCostReduction?.(state.player, state.player.hero,
      { baseCost: 2, sourceType: 'heroPower' })?.cost ?? 2;
    Object.assign(result, { playableCardsRemaining: nonEnd.filter(item => item.action.card && !item.action.usePower).length,
      legalAttacksRemaining: nonEnd.filter(item => item.action.attack).length,
      combinedCardAndHeroPowerActionsAvailable: nonEnd.filter(item => item.action.card && item.action.usePower).length,
      remainingManaAfterHeroPower: Math.max(0, state.pool - powerCost) });
  }
  return result;
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
  const diagnosticMcts = new MCTS_AI({ game, resourceSystem: game.resources, combatSystem: game.combat,
    iterations: 1, rolloutDepth: 1, fullSim: false, policyValueModel: null });
  const lethalActionIds = new Set();
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    const outcome = seededSync((baseSeed + index) >>> 0, () => diagnosticMcts._applyAction(state, { ...action,
      ...(action.attack ? { attack: { ...action.attack } } : {}) }));
    if (outcome.lethal || heroHealth(outcome.state?.opponent) != null && heroHealth(outcome.state.opponent) <= 0) lethalActionIds.add(`a${index}`);
  }
  const candidates = [];
  for (const [actionId, sources] of selections) {
    const actionIndex = Number(actionId.slice(1));
    const action = actions[actionIndex];
    if (!action || `a${actionIndex}` !== actionId) throw new Error(`Recorded candidate ${actionId} is not legal`);
    const signature = actionSignature(action);
    const descriptor = (event.legalActions || event.decisionInput?.actions || [])[actionIndex] || {};
    const diagnosticOutcome = seededSync((baseSeed + actionIndex) >>> 0, () => diagnosticMcts._applyAction(state, { ...action,
      ...(action.attack ? { attack: { ...action.attack } } : {}) }));
    const effects = immediateMetrics(state, diagnosticOutcome.state);
    const classification = classifyAction(action, state, { immediateEffects: effects });
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
      let estimatedValue; let terminal = false; let outcomeLabel = null; let rootVisits = 0; let searchEnded = false;
      if (opponentHealth != null && opponentHealth <= 0) {
        terminal = true; outcomeLabel = 'win'; estimatedValue = WIN_CONDITION_BONUS;
      } else if (playerHealth != null && playerHealth <= 0) {
        terminal = true; outcomeLabel = 'loss'; estimatedValue = -WIN_CONDITION_BONUS;
      } else if (outcome.terminal) {
        searchEnded = true; estimatedValue = clampCounterfactualValue(outcome.value);
      } else {
        await seeded(seed, () => fullSim ? mcts._searchFullSimAsync(outcome.state) : mcts._searchAsync(outcome.state));
        const root = mcts._lastTree?.node;
        rootVisits = root?.visits || 0;
        estimatedValue = clampCounterfactualValue(rootVisits ? root.total / rootVisits : fullSim
          ? (await mcts._resolveCombatAndScoreSim(outcome.state)).value : mcts._heuristicRolloutValue(outcome.state));
      }
      runs.push({ seed, estimatedValue, terminal, ...(outcomeLabel ? { outcome: outcomeLabel } : {}),
        ...(searchEnded ? { searchEnded: true } : {}), rootVisits });
    }
    const distinctRepeatValues = new Set(runs.map(run => run.estimatedValue)).size;
    candidates.push({ actionId, actionSignature: signature, description: descriptor.description || actionId,
      selectedBy: [...sources], classification, immediateEffects: effects,
      immediateLethal: lethalActionIds.has(actionId), ...stats(runs.map(run => run.estimatedValue)),
      distinctRepeatValues, repeatRange: Math.max(...runs.map(run => run.estimatedValue)) - Math.min(...runs.map(run => run.estimatedValue)), runs });
    progress?.({ completed: candidates.length, total: selections.size, actionId });
  }
  const jev = candidates.find(candidate => candidate.selectedBy.includes('jev'));
  const neural = candidates.find(candidate => candidate.selectedBy.includes('neural'));
  const sequencing = event.agent === 'jev' && ['end-turn', 'hero-power'].includes(event.selectedActionType)
    ? sequencingDiagnostics(event, state, actions) : null;
  if (sequencing && jev && neural) Object.assign(sequencing, { jevEstimatedValue: jev.estimatedValue,
    neuralAlternativeValue: neural.estimatedValue, valueGap: jev.estimatedValue - neural.estimatedValue,
    neuralAlternativeClass: neural.classification.primary });
  return { schemaVersion: COUNTERFACTUAL_SCHEMA_VERSION, analysisType: 'counterfactual-mcts',
    evaluatorVersion: COUNTERFACTUAL_EVALUATOR_VERSION, matchId: event.matchId,
    decisionIndex: event.decisionIndex, positionFingerprint: positionFingerprint(event.analysisSnapshot),
    originalPlayer: event.playerId, selectedActionType: event.selectedActionType,
    disagreement: jev && neural ? { jevChoiceClass: jev.classification.primary,
      neuralChoiceClass: neural.classification.primary,
      jevStrategic: primaryStrategicCategory(jev.classification), neuralStrategic: primaryStrategicCategory(neural.classification) } : null,
    lethal: { lethalAvailable: lethalActionIds.size > 0, lethalActionIds: [...lethalActionIds],
      jevSelectedLethal: !!jev?.immediateLethal, neuralSelectedLethal: !!neural?.immediateLethal },
    ...(sequencing ? { sequencing } : {}),
    evaluator: { type: 'mcts', iterations, rolloutDepth,
      fullSim, policyGuidance: 'none', informationMode: 'perfect', repeats, baseSeed,
      valueScale: `bounded heuristic [${NON_TERMINAL_VALUE_MIN}, ${NON_TERMINAL_VALUE_MAX}]; terminal win/loss = +/-${WIN_CONDITION_BONUS}` }, candidates };
}

export function counterfactualCacheKey(event, config, actionSignatureValue = '') {
  return [COUNTERFACTUAL_EVALUATOR_VERSION, event.matchId, event.decisionIndex,
    positionFingerprint(event.analysisSnapshot), actionSignatureValue, config.iterations,
    config.rolloutDepth, !!config.fullSim, config.repeats, config.baseSeed].join('|');
}
