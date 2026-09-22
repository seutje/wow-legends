import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';
import { actionSignature } from '../src/js/systems/ai-signatures.js';
import { serializeLegalActions } from '../src/js/systems/ai-serialization.js';
import RemoteDecisionAgent from '../src/js/systems/ai-remote.js';
import NeuralAI, { NeuralPolicyValueModel, loadModelFromDiskOrFetch } from '../src/js/systems/ai-nn.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

export const EVALUATION_AGENT_IDS = Object.freeze(['basic', 'mcts', 'neural', 'neural-mcts', 'jev']);
const MODEL_IDS = new Set(EVALUATION_AGENT_IDS);
const now = () => performance.now();
const safeNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

function safeMetadata(metadata, legalIds) {
  if (!metadata || typeof metadata !== 'object') return null;
  const result = {};
  if (metadata.provider === 'openrouter') result.provider = 'openrouter';
  if (typeof metadata.model === 'string' && /^[~\w.-]+\/[\w.-]+$/.test(metadata.model)) result.model = metadata.model;
  if (typeof metadata.requestId === 'string' && /^[\w-]+$/.test(metadata.requestId)
    && !metadata.requestId.startsWith('sk-')) result.requestId = metadata.requestId;
  if (safeNumber(metadata.confidence) !== null) result.confidence = metadata.confidence;
  if (safeNumber(metadata.latencyMs) !== null) result.providerLatencyMs = metadata.latencyMs;
  if (safeNumber(metadata.cost) !== null) result.cost = metadata.cost;
  if (metadata.probabilities && typeof metadata.probabilities === 'object') {
    const probabilities = Object.fromEntries(Object.entries(metadata.probabilities)
      .filter(([id, probability]) => legalIds.has(id) && safeNumber(probability) !== null && probability >= 0 && probability <= 1));
    if (Object.keys(probabilities).length) result.probabilities = probabilities;
  }
  if (metadata.usage && typeof metadata.usage === 'object') {
    const usage = Object.fromEntries(Object.entries(metadata.usage)
      .filter(([, value]) => safeNumber(value) !== null));
    if (Object.keys(usage).length) result.usage = usage;
  }
  return Object.keys(result).length ? result : null;
}

function withSeededRandom(rng, fn) {
  const original = Math.random;
  Math.random = () => rng.random();
  return Promise.resolve().then(fn).finally(() => { Math.random = original; });
}

export async function loadEvaluationDeck(name = 'deck1') {
  if (typeof name !== 'string' || !/^deck\d+$/.test(name)) throw new Error('Deck must be a bundled deck name such as deck1');
  const raw = JSON.parse(await readFile(new URL(`../data/decks/${name}.json`, import.meta.url), 'utf8'));
  const types = ['hero', 'spell', 'ally', 'equipment', 'quest', 'consumable'];
  const catalog = (await Promise.all(types.map(async type => JSON.parse(await readFile(
    new URL(`../data/cards/${type}.json`, import.meta.url), 'utf8'))))).flat();
  const byId = new Map(catalog.map(card => [card.id, card]));
  const hero = byId.get(raw.hero);
  const cards = raw.cards?.map(id => byId.get(id));
  if (!hero || hero.type !== 'hero' || cards?.length !== 60 || cards.some(card => !card)) {
    throw new Error(`Invalid bundled deck: ${name}`);
  }
  return { id: name, hero, cards };
}

export async function createEvaluationAgent(id, { game, client, model = null,
  mctsIterations = 100, rolloutDepth = 5, rng = new RNG(1) } = {}) {
  if (!MODEL_IDS.has(id)) throw new RangeError(`Unknown evaluation agent: ${id}`);
  if (id === 'jev') {
    if (!client || typeof client.decide !== 'function') throw new Error('Jev evaluation requires an injected decision client');
    let decision = null;
    const remote = new RemoteDecisionAgent({ client, onDecision: value => { decision = value; } });
    return { id, async chooseAction(state, actions) { decision = null; return remote.chooseAction(state, actions); },
      takeMetadata() { return decision?.metadata ?? null; } };
  }
  if (id === 'basic') {
    let lastTurn = null;
    let playedCard = false;
    return { id, async chooseAction(state, actions) {
      if (lastTurn !== state.turn) { lastTurn = state.turn; playedCard = false; }
      if (!playedCard) {
        const card = actions.filter(action => action.card && !action.usePower)
          .sort((a, b) => (a.card.cost || 0) - (b.card.cost || 0))[0];
        if (card) { playedCard = true; return card; }
      }
      return actions.find(action => action.attack) || actions.find(action => action.end);
    } };
  }
  const resolvedModel = model || (id === 'neural' || id === 'neural-mcts'
    ? await loadModelFromDiskOrFetch() : null);
  if (id === 'neural') {
    const neural = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model: resolvedModel });
    return { id, async chooseAction(state, actions) {
      const choice = await neural.chooseAction(state, actions);
      // NeuralAI's current policy omits attack features; retain its scoring for
      // card/power choices and use canonical legal attacks when it would end.
      return choice?.end ? (actions.find(action => action.attack) || choice) : choice;
    } };
  }
  const policyValueModel = id === 'neural-mcts' ? new NeuralPolicyValueModel({ model: resolvedModel }) : null;
  const search = new MCTS_AI({ game, resourceSystem: game.resources, combatSystem: game.combat,
    iterations: mctsIterations, rolloutDepth, policyValueModel });
  return { id, async chooseAction(state, actions) {
    const candidate = await withSeededRandom(rng, () => search._searchAsync(state));
    // MCTS annotates spell candidates with an internal target trace; the engine
    // executes the corresponding canonical card action through its usual target flow.
    const signature = actionSignature(candidate && { ...candidate, __mctsTargetSignature: undefined });
    const exact = actions.find(action => actionSignature(action) === signature);
    if (!exact) throw new Error('MCTS selected an action outside the canonical legal set');
    return exact;
  } };
}

function agentId(agent) { return typeof agent === 'string' ? agent : agent?.id || 'custom'; }
function deckId(deck) { return typeof deck === 'string' ? deck : deck?.id || 'custom'; }
function actionType(action, serialized) { return serialized?.type || (action?.end ? 'end-turn' : 'unknown'); }

function summarizeNeural(evaluator, state, actions, serialized, selectedId) {
  if (!evaluator) return null;
  const evaluated = evaluator.evaluate(state, actions);
  const policy = Object.fromEntries(actions.map((action, index) => [serialized[index].id,
    safeNumber(evaluated.policy?.get(actionSignature(action))) ?? 0]));
  const topId = Object.keys(policy).reduce((best, id) => policy[id] > policy[best] ? id : best);
  return { topActionId: topId, policy, agreement: topId === selectedId };
}

export async function runMatch({ agentA = 'basic', agentB = 'basic', deckA = 'deck1', deckB = deckA,
  seed = 1, startingPlayer = 'A', matchId = `seed-${seed}-${startingPlayer}`,
  client = null, model = null, compareNeural = false, neuralEvaluator = null,
  compareMctsEvery = 0, mctsIterations = 100, rolloutDepth = 5,
  maxTurns = 40, maxDecisions = 1000, agentFactory = createEvaluationAgent,
  configureGame = null } = {}) {
  if (!Number.isInteger(seed) || !Number.isInteger(maxTurns) || maxTurns < 1) throw new RangeError('Invalid match seed or turn limit');
  if (startingPlayer !== 'A' && startingPlayer !== 'B') throw new RangeError('startingPlayer must be A or B');
  const resolvedDeckA = typeof deckA === 'string' ? await loadEvaluationDeck(deckA) : deckA;
  const resolvedDeckB = typeof deckB === 'string' ? await loadEvaluationDeck(deckB) : deckB;
  if (!resolvedDeckA?.hero || !resolvedDeckB?.hero || resolvedDeckA.cards?.length !== 60 || resolvedDeckB.cards?.length !== 60) {
    throw new Error('Both evaluation decks must have a hero and 60 cards');
  }
  const game = new Game(null, { aiPlayers: ['player', 'opponent'], seed,
    startingPlayer: startingPlayer === 'A' ? 'player' : 'opponent', aiActionDelayMs: 0 });
  const started = now();
  const events = [];
  const decisions = { A: 0, B: 0 };
  const agents = {};
  let status = 'completed';
  let errorType = null;
  let turns = 0;
  let activeSide = null;
  let comparisonModel = model;
  try {
    await game.setupMatch({ hero: resolvedDeckA.hero, cards: resolvedDeckA.cards,
      opponentDeck: { hero: resolvedDeckB.hero, cards: resolvedDeckB.cards } });
    if (configureGame) await configureGame(game);
    if (((compareNeural && !neuralEvaluator) || agentId(agentA) === 'neural-mcts'
      || agentId(agentB) === 'neural-mcts') && !comparisonModel) {
      comparisonModel = await loadModelFromDiskOrFetch();
    }
    const evaluator = neuralEvaluator || (compareNeural ? new NeuralPolicyValueModel({ model: comparisonModel }) : null);
    const specs = { A: agentA, B: agentB };
    for (const side of ['A', 'B']) {
      agents[side] = typeof specs[side] === 'string'
        ? await agentFactory(specs[side], { game, client, model: comparisonModel, mctsIterations, rolloutDepth,
          rng: new RNG((seed ^ (side === 'A' ? 0xA1A1 : 0xB2B2)) >>> 0) }) : specs[side];
      if (!agents[side] || typeof agents[side].chooseAction !== 'function') throw new TypeError('Evaluation agent must implement chooseAction');
    }
    const mctsComparator = compareMctsEvery > 0
      ? await agentFactory('mcts', { game, mctsIterations, rolloutDepth, rng: new RNG(seed ^ 0xC3C3) }) : null;
    const wrapped = Object.fromEntries(['A', 'B'].map(side => [side, { async chooseAction(state, actions) {
      if (events.length >= maxDecisions) throw new Error('decision_limit');
      const { actions: serialized } = serializeLegalActions(actions, state);
      const start = now();
      const selected = await agents[side].chooseAction(state, actions);
      const latencyMs = now() - start;
      const index = actions.indexOf(selected);
      if (index < 0) throw new Error('invalid_agent_action');
      const chosen = serialized[index];
      const metadata = safeMetadata(agents[side].takeMetadata?.(), new Set(serialized.map(item => item.id)));
      const event = { matchId, turn: game.turns.turn, playerId: side, agent: agentId(specs[side]),
        legalActionCount: actions.length, selectedActionId: chosen.id,
        selectedActionSignature: actionSignature(selected), selectedActionType: actionType(selected, chosen),
        description: chosen.description, latencyMs };
      if (metadata) event.metadata = metadata;
      if (agentId(specs[side]) === 'jev') {
        if (evaluator) event.neuralComparison = summarizeNeural(evaluator, state, actions, serialized, chosen.id);
        if (mctsComparator && (events.filter(item => item.agent === 'jev').length % compareMctsEvery === 0)) {
          const suggested = await mctsComparator.chooseAction(state, actions);
          const comparisonIndex = actions.indexOf(suggested);
          if (comparisonIndex >= 0) event.mctsComparison = {
            topActionId: serialized[comparisonIndex].id, agreement: comparisonIndex === index };
        }
      }
      events.push(event);
      decisions[side] += 1;
      return selected;
    } }]));
    while (!game.isGameOver() && turns < maxTurns) {
      const side = game.turns.activePlayer === game.player ? 'A' : 'B';
      activeSide = side;
      const player = side === 'A' ? game.player : game.opponent;
      const opponent = side === 'A' ? game.opponent : game.player;
      const completed = await game.runAgentTurn({ agent: wrapped[side], player, opponent, skipStart: true });
      turns += 1;
      if (!completed) throw new Error('invalid_agent_action');
      if (game.isGameOver()) break;
      while (game.turns.current !== 'End') game.turns.nextPhase();
      game.turns.nextPhase();
      game.turns.setActivePlayer(opponent);
      game.turns.startTurn();
      game.resources.startTurn(opponent);
    }
    if (!game.isGameOver()) status = 'limit';
  } catch (error) {
    status = 'error';
    errorType = activeSide && agentId(activeSide === 'A' ? agentA : agentB) === 'jev'
      ? 'remote-decision-failed' : (error?.message === 'decision_limit' ? 'decision-limit'
      : error?.message === 'invalid_agent_action' ? 'invalid-agent-action' : 'agent-or-engine-failed');
  }
  const winner = status === 'completed' ? game.state.winner === 'player' ? 'A'
    : game.state.winner === 'opponent' ? 'B' : game.state.winner === 'draw' ? 'draw' : null : null;
  return { matchId, seed, agentA: agentId(agentA), agentB: agentId(agentB),
    deckA: deckId(deckA), deckB: deckId(deckB), startingPlayer, status,
    ...(errorType ? { errorType } : {}), winner,
    loser: winner === 'A' ? 'B' : winner === 'B' ? 'A' : null,
    endReason: status === 'completed' ? 'hero-defeated' : null,
    turns, decisions, durationMs: now() - started, decisionEvents: events,
    finalHealth: { A: game.player.hero?.data?.health ?? null, B: game.opponent.hero?.data?.health ?? null } };
}

export async function runMirroredPair(options = {}) {
  const seed = options.seed ?? 1;
  return [await runMatch({ ...options, seed, startingPlayer: 'A', matchId: `seed-${seed}-A` }),
    await runMatch({ ...options, seed, startingPlayer: 'B', matchId: `seed-${seed}-B` })];
}

export async function runSeries({ games = 2, baseSeed = 1, mirror = true, ...options } = {}) {
  if (!Number.isInteger(games) || games < 1 || !Number.isInteger(baseSeed)
    || (mirror && games % 2 !== 0)) throw new RangeError('Games must be positive and even when mirrored');
  const matches = [];
  for (let index = 0; index < (mirror ? games / 2 : games); index++) {
    const seed = (baseSeed + index) >>> 0;
    if (mirror) matches.push(...await runMirroredPair({ ...options, seed }));
    else matches.push(await runMatch({ ...options, seed, startingPlayer: index % 2 ? 'B' : 'A' }));
  }
  const agentNames = { A: agentId(options.agentA || 'basic'), B: agentId(options.agentB || 'basic') };
  const agents = Object.fromEntries(['A', 'B'].map(side => [side, {
    id: agentNames[side], wins: 0, losses: 0, draws: 0, decisions: 0,
    totalDecisionLatencyMs: 0, avgDecisionLatencyMs: null, actionTypes: {}, usage: {} }]));
  const startingPosition = { A: { games: 0, wins: 0 }, B: { games: 0, wins: 0 } };
  let agreementCount = 0;
  let agreementTotal = 0;
  let mctsAgreementCount = 0;
  let mctsAgreementTotal = 0;
  for (const match of matches) {
    if (match.status === 'completed') {
      startingPosition[match.startingPlayer].games += 1;
      if (match.winner === match.startingPlayer) startingPosition[match.startingPlayer].wins += 1;
      if (match.winner === 'draw') { agents.A.draws++; agents.B.draws++; }
      else if (match.winner) { agents[match.winner].wins++; agents[match.loser].losses++; }
    }
    for (const event of match.decisionEvents) {
      const stats = agents[event.playerId];
      stats.decisions += 1;
      stats.totalDecisionLatencyMs += event.latencyMs;
      stats.actionTypes[event.selectedActionType] = (stats.actionTypes[event.selectedActionType] || 0) + 1;
      if (event.metadata?.cost !== undefined) stats.cost = (stats.cost || 0) + event.metadata.cost;
      for (const [key, value] of Object.entries(event.metadata?.usage || {})) {
        stats.usage[key] = (stats.usage[key] || 0) + value;
      }
      if (event.neuralComparison) {
        agreementTotal += 1;
        if (event.neuralComparison.agreement) agreementCount += 1;
      }
      if (event.mctsComparison) {
        mctsAgreementTotal += 1;
        if (event.mctsComparison.agreement) mctsAgreementCount += 1;
      }
    }
  }
  for (const stats of Object.values(agents)) {
    if (stats.decisions) stats.avgDecisionLatencyMs = stats.totalDecisionLatencyMs / stats.decisions;
  }
  return { config: { agentA: agentNames.A, agentB: agentNames.B, deckA: deckId(options.deckA || 'deck1'),
    deckB: deckId(options.deckB || options.deckA || 'deck1'), games, baseSeed, mirrored: mirror,
    informationMode: 'player', maxTurns: options.maxTurns ?? 40, maxDecisions: options.maxDecisions ?? 1000,
    compareNeural: !!options.compareNeural, compareMctsEvery: options.compareMctsEvery ?? 0,
    ...(agentNames.A === 'jev' || agentNames.B === 'jev' ? { jevModel: options.jevModel || '~typesafe/jev-latest' } : {}),
    ...(agentNames.A.includes('mcts') || agentNames.B.includes('mcts') ? {
      mctsIterations: options.mctsIterations ?? 100, rolloutDepth: options.rolloutDepth ?? 5 } : {}) },
  completedGames: matches.filter(match => match.status === 'completed').length,
  failedGames: matches.filter(match => match.status === 'error').length,
  limitedGames: matches.filter(match => match.status === 'limit').length,
  averageTurns: matches.some(match => match.status === 'completed')
    ? matches.filter(match => match.status === 'completed').reduce((total, match) => total + match.turns, 0)
      / matches.filter(match => match.status === 'completed').length : null,
  agents, startingPosition,
  agreement: {
    ...(agreementTotal ? { jevVsNeural: agreementCount / agreementTotal, neuralSamples: agreementTotal } : {}),
    ...(mctsAgreementTotal ? { jevVsMcts: mctsAgreementCount / mctsAgreementTotal, mctsSamples: mctsAgreementTotal } : {}),
  },
  games: matches };
}

export async function writeEvaluationResults(result, directory, basename = 'evaluation') {
  if (!/^[\w-]+$/.test(basename)) throw new Error('Invalid evaluation filename');
  await mkdir(directory, { recursive: true });
  const summaryPath = join(directory, `${basename}-summary.json`);
  const decisionsPath = join(directory, `${basename}-decisions.jsonl`);
  const summary = { ...result, games: result.games.map(({ decisionEvents, ...game }) => game) };
  const lines = result.games.flatMap(game => game.decisionEvents).map(event => JSON.stringify(event));
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(decisionsPath, lines.length ? `${lines.join('\n')}\n` : '');
  return { summaryPath, decisionsPath };
}
