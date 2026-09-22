import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecisionJsonl, normalizeEvaluationRun } from '../src/js/evaluation/data.js';
import { evaluateCounterfactualDecision } from '../src/js/systems/ai-counterfactual.js';

export function parseCounterfactualArgs(argv) {
  const valueKeys = new Set(['input', 'decisions', 'output', 'game', 'decision', 'iterations', 'depth', 'repeats', 'seed', 'limit']);
  const flags = new Set(['all-actions', 'disagreements-only', 'all', 'full-sim']); const raw = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]?.replace(/^--/, '');
    if (valueKeys.has(key)) raw[key] = argv[++index];
    else if (flags.has(key)) raw[key] = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (!raw.input) throw new Error('--input is required');
  const integer = (key, fallback, minimum = 1) => { const value = raw[key] == null ? fallback : Number(raw[key]); if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid --${key}`); return value; };
  return { input: raw.input, decisions: raw.decisions, output: raw.output || raw.input.replace(/(?:-summary)?\.json$/i, '-counterfactuals.json'),
    game: raw.game == null ? null : integer('game', null), decision: raw.decision == null ? null : integer('decision', null),
    iterations: integer('iterations', 1000), rolloutDepth: integer('depth', 10), repeats: integer('repeats', 1),
    baseSeed: integer('seed', 1, 0), limit: integer('limit', 10), candidateMode: raw['all-actions'] ? 'all' : 'selected-agents-only',
    fullSim: !!raw['full-sim'], disagreementsOnly: !!raw['disagreements-only'], allowLargeBatch: !!raw.all };
}

export async function analyzeCounterfactualRun(options) {
  const summary = JSON.parse(await readFile(options.input, 'utf8'));
  const decisions = options.decisions ? parseDecisionJsonl(await readFile(options.decisions, 'utf8')) : null;
  const run = normalizeEvaluationRun(summary, decisions);
  let targets = [];
  if (options.game != null || options.decision != null) {
    if (options.game == null || options.decision == null) throw new Error('--game and --decision must be used together');
    const game = run.games[options.game - 1]; const event = game?.decisionEvents[options.decision - 1];
    if (!event) throw new Error('Selected game or decision does not exist'); targets = [event];
  } else {
    targets = run.decisionEvents.filter(event => !options.disagreementsOnly
      || (event.neuralComparison?.topActionId && event.neuralComparison.topActionId !== event.selectedActionId));
  }
  if (!options.allowLargeBatch) targets = targets.slice(0, options.limit);
  const config = { iterations: options.iterations, rolloutDepth: options.rolloutDepth,
    repeats: options.repeats, baseSeed: options.baseSeed, candidateMode: options.candidateMode, fullSim: options.fullSim };
  let cached = [];
  try {
    const previous = JSON.parse(await readFile(options.output, 'utf8'));
    if (JSON.stringify(previous.analysisConfig?.iterations) === JSON.stringify(config.iterations)
      && previous.analysisConfig?.rolloutDepth === config.rolloutDepth
      && previous.analysisConfig?.repeats === config.repeats
      && previous.analysisConfig?.baseSeed === config.baseSeed
      && !!previous.analysisConfig?.fullSim === config.fullSim
      && previous.analysisConfig?.candidateMode === config.candidateMode) cached = previous.analyses || [];
  } catch {}
  const analyses = [];
  for (let index = 0; index < targets.length; index++) {
    const event = targets[index];
    const existing = cached.find(item => item.matchId === event.matchId && item.decisionIndex === event.decisionIndex
      && item.positionFingerprint === event.positionFingerprint && item.status !== 'error');
    if (existing) { analyses.push(existing); process.stdout.write(`Cached ${index + 1}/${targets.length}: ${event.matchId} decision ${event.decisionIndex + 1}\n`); continue; }
    process.stdout.write(`Analyzing ${index + 1}/${targets.length}: ${event.matchId} decision ${event.decisionIndex + 1}\n`);
    try { analyses.push(await evaluateCounterfactualDecision({ event, config })); }
    catch (error) { analyses.push({ schemaVersion: 1, analysisType: 'counterfactual-mcts', matchId: event.matchId,
      decisionIndex: event.decisionIndex, status: 'error', errorType: error.message.includes('do not match') ? 'reconstruction-mismatch' : 'analysis-failed', message: error.message }); }
  }
  const output = { schemaVersion: 1, analysisType: 'counterfactual-mcts-collection',
    evaluationSchemaVersion: run.schemaVersion, analysisConfig: { ...config, policyGuidance: 'none', informationMode: 'perfect' }, analyses };
  await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`Wrote ${analyses.length} analyses to ${options.output}\n`);
  return output;
}

export async function main(argv = process.argv.slice(2)) { return analyzeCounterfactualRun(parseCounterfactualArgs(argv)); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Counterfactual analysis failed: ${error.message}\n`); process.exitCode = 1; });
