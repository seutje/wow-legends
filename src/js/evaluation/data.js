export const EVALUATION_SCHEMA_VERSION = 1;
const SECRET_KEY = /api[-_]?key|authorization|headers?|cookie|credential|password|secret/i;
const TOKEN_KEY = /(?:^|[_-])(?:access|refresh)?token$/i;

export class EvaluationDataError extends Error {
  constructor(message) { super(message); this.name = 'EvaluationDataError'; }
}

export function sanitizeForDisplay(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map(item => sanitizeForDisplay(item, seen));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && (/bearer\s+[\w.-]+/i.test(value) || /^sk-[\w.-]+$/i.test(value))) return '[redacted]';
    return value;
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    clean[key] = SECRET_KEY.test(key) || TOKEN_KEY.test(key) ? '[redacted]' : sanitizeForDisplay(item, seen);
  }
  seen.delete(value);
  return clean;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvaluationDataError(`${label} must be an object`);
  return value;
}

export function parseEvaluationJson(text) {
  try { return object(JSON.parse(text), 'Evaluation JSON'); }
  catch (error) {
    if (error instanceof EvaluationDataError) throw error;
    throw new EvaluationDataError(`Malformed evaluation JSON: ${error.message}`);
  }
}

export function parseDecisionJsonl(text) {
  if (!text.trim()) return [];
  return text.split(/\r?\n/).reduce((events, line, index) => {
    if (!line.trim()) return events;
    try { events.push(object(JSON.parse(line), `Decision on line ${index + 1}`)); }
    catch (error) {
      if (error instanceof EvaluationDataError) throw error;
      throw new EvaluationDataError(`Malformed JSONL at line ${index + 1}: ${error.message}`);
    }
    return events;
  }, []);
}

function validateEvent(event, index) {
  object(event, `Decision ${index + 1}`);
  if (typeof event.matchId !== 'string' || !event.matchId) throw new EvaluationDataError(`Decision ${index + 1} is missing matchId`);
  if (typeof event.selectedActionId !== 'string' || !event.selectedActionId) {
    throw new EvaluationDataError(`Decision ${index + 1} is missing selectedActionId`);
  }
  if (event.decisionInput) {
    object(event.decisionInput, `Decision ${index + 1} input`);
    if (!Array.isArray(event.decisionInput.actions)) throw new EvaluationDataError(`Decision ${index + 1} has invalid legal actions`);
  }
  return sanitizeForDisplay(event);
}

export function normalizeEvaluationRun(summaryRaw, decisionEventsRaw = null) {
  const summary = sanitizeForDisplay(object(summaryRaw, 'Evaluation summary'));
  const version = summary.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > EVALUATION_SCHEMA_VERSION) {
    throw new EvaluationDataError(`Unsupported evaluation schema version: ${version}`);
  }
  if (!Array.isArray(summary.games) || !summary.games.length) throw new EvaluationDataError('Evaluation run contains no games');
  const embedded = summary.games.flatMap(game => Array.isArray(game.decisionEvents) ? game.decisionEvents : []);
  const rawEvents = decisionEventsRaw == null ? embedded : decisionEventsRaw;
  if (!Array.isArray(rawEvents)) throw new EvaluationDataError('Decision events must be an array');
  const events = rawEvents.map(validateEvent);
  const byMatch = new Map();
  for (const event of events) {
    if (!byMatch.has(event.matchId)) byMatch.set(event.matchId, []);
    byMatch.get(event.matchId).push(event);
  }
  const games = summary.games.map((raw, index) => {
    const game = sanitizeForDisplay(object(raw, `Game ${index + 1}`));
    if (typeof game.matchId !== 'string' || !game.matchId) throw new EvaluationDataError(`Game ${index + 1} is missing matchId`);
    return { ...game, index, decisionEvents: byMatch.get(game.matchId) || game.decisionEvents || [] };
  });
  return { ...summary, schemaVersion: version, legacy: version === 0, games,
    decisionEvents: games.flatMap(game => game.decisionEvents) };
}

export function actionRows(event) {
  const actions = event?.legalActions || event?.decisionInput?.actions || [];
  const jev = event?.metadata?.probabilities || {};
  const neural = event?.neuralComparison?.policy || {};
  const mcts = event?.mctsComparison?.actions || {};
  return actions.map((action, index) => ({ ...action, originalIndex: index,
    jevProbability: Number.isFinite(jev[action.id]) ? jev[action.id] : null,
    neuralProbability: Number.isFinite(neural[action.id]) ? neural[action.id] : null,
    neuralValue: Number.isFinite(event?.neuralComparison?.actionValues?.[action.id])
      ? event.neuralComparison.actionValues[action.id] : null,
    mcts: mcts[action.id] || null,
    selectedByJev: event.agent === 'jev' && event.selectedActionId === action.id,
    selectedByAgent: event.selectedActionId === action.id,
    selectedByNeural: event.neuralComparison?.topActionId === action.id,
    selectedByMcts: event.mctsComparison?.topActionId === action.id }));
}

export function decisionAgreement(event) {
  const neural = event?.neuralComparison?.topActionId;
  return neural ? neural === event.selectedActionId : null;
}

export function probabilityComparison(event) {
  const rows = actionRows(event);
  const jevChoice = rows.find(row => row.id === event?.selectedActionId);
  const neuralChoice = rows.find(row => row.id === event?.neuralComparison?.topActionId);
  return { jevChoice: jevChoice ? { id: jevChoice.id, jev: jevChoice.jevProbability, neural: jevChoice.neuralProbability } : null,
    neuralChoice: neuralChoice ? { id: neuralChoice.id, jev: neuralChoice.jevProbability, neural: neuralChoice.neuralProbability } : null,
    topChoiceGap: jevChoice && neuralChoice && jevChoice.jevProbability !== null && neuralChoice.jevProbability !== null
      ? jevChoice.jevProbability - neuralChoice.jevProbability : null };
}

export function jensenShannonDivergence(event) {
  const rows = actionRows(event);
  if (!rows.length || rows.some(row => row.jevProbability === null || row.neuralProbability === null)) return null;
  const pTotal = rows.reduce((sum, row) => sum + row.jevProbability, 0);
  const qTotal = rows.reduce((sum, row) => sum + row.neuralProbability, 0);
  if (pTotal <= 0 || qTotal <= 0) return null;
  const term = (value, mean) => value === 0 ? 0 : value * Math.log2(value / mean);
  return rows.reduce((sum, row) => {
    const p = row.jevProbability / pTotal;
    const q = row.neuralProbability / qTotal;
    const mean = (p + q) / 2;
    return sum + (term(p, mean) + term(q, mean)) / 2;
  }, 0);
}

export function aggregateComparisons(events) {
  const compared = events.filter(event => decisionAgreement(event) !== null);
  const actionTypes = {};
  let agreements = 0;
  let divergenceTotal = 0;
  let divergenceCount = 0;
  for (const event of compared) {
    const agreed = decisionAgreement(event);
    if (agreed) agreements++;
    const type = event.selectedActionType || 'unknown';
    actionTypes[type] ||= { compared: 0, agreements: 0, disagreements: 0 };
    actionTypes[type].compared++;
    actionTypes[type][agreed ? 'agreements' : 'disagreements']++;
    const divergence = jensenShannonDivergence(event);
    if (divergence !== null) { divergenceTotal += divergence; divergenceCount++; }
  }
  return { compared: compared.length, agreements, disagreements: compared.length - agreements,
    actionTypes, averageJensenShannon: divergenceCount ? divergenceTotal / divergenceCount : null };
}
