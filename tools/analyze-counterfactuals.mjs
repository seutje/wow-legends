import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecisionJsonl, normalizeEvaluationRun } from '../src/js/evaluation/data.js';
import { evaluateCounterfactualDecision } from '../src/js/systems/ai-counterfactual.js';
import { createSampleManifest, sampleCounterfactualPositions, SAMPLING_STRATEGIES } from './counterfactual-sampling.mjs';

export function parseCounterfactualArgs(argv) {
  const valueKeys = new Set(['input', 'decisions', 'output', 'game', 'decision', 'iterations', 'depth', 'repeats', 'seed', 'limit',
    'sampling', 'sampling-seed', 'max-per-match', 'action-type', 'action-types', 'sample-manifest', 'sample-manifest-input']);
  const flags = new Set(['all-actions', 'disagreements-only', 'all', 'full-sim', 'dry-run']); const raw = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]?.replace(/^--/, '');
    if (valueKeys.has(key)) raw[key] = argv[++index];
    else if (flags.has(key)) raw[key] = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (!raw.input) throw new Error('--input is required');
  const integer = (key, fallback, minimum = 1) => { const value = raw[key] == null ? fallback : Number(raw[key]); if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid --${key}`); return value; };
  const sampling = raw.sampling || 'stratified';
  if (!SAMPLING_STRATEGIES.includes(sampling)) throw new Error(`--sampling must be one of: ${SAMPLING_STRATEGIES.join(', ')}`);
  const actionTypes = (raw['action-types'] || raw['action-type'] || '').split(',').map(value => value.trim()).filter(Boolean);
  return { input: raw.input, decisions: raw.decisions, output: raw.output || raw.input.replace(/(?:-summary)?\.json$/i, '-counterfactuals.json'),
    game: raw.game == null ? null : integer('game', null), decision: raw.decision == null ? null : integer('decision', null),
    iterations: integer('iterations', 1000), rolloutDepth: integer('depth', 10), repeats: integer('repeats', 1),
    baseSeed: integer('seed', 1, 0), limit: raw.all || raw['sample-manifest-input'] && raw.limit == null ? Infinity : integer('limit', 10), candidateMode: raw['all-actions'] ? 'all' : 'selected-agents-only',
    sampling, samplingSeed: integer('sampling-seed', 1, 0), maxPerMatch: raw['max-per-match'] == null ? Infinity : integer('max-per-match', null),
    actionTypes, sampleManifest: raw['sample-manifest'] || null, sampleManifestInput: raw['sample-manifest-input'] || null,
    dryRun: !!raw['dry-run'], fullSim: !!raw['full-sim'], disagreementsOnly: !!raw['disagreements-only'], allowLargeBatch: !!raw.all };
}

export function formatSamplingPreview(metadata) {
  const lines = [`Eligible positions: ${metadata.eligiblePositions}`, `Eligible matches: ${metadata.eligibleMatches}`, '',
    `Sampling strategy: ${metadata.strategy}`, `Sampling seed: ${metadata.seed}`,
    `Requested limit: ${metadata.requestedLimit ?? 'all'}`, `Max per match: ${metadata.maxPerMatch ?? 'none'}`, '',
    `Selected positions: ${metadata.selectedPositions}`, `Matches represented: ${metadata.sampledMatches}`, '', 'Action types:'];
  for (const [type, count] of Object.entries(metadata.actionTypes).sort()) lines.push(`  ${type}: ${count}`);
  return `${lines.join('\n')}\n`;
}

export async function analyzeCounterfactualRun(options) {
  const summary = JSON.parse(await readFile(options.input, 'utf8'));
  const decisions = options.decisions ? parseDecisionJsonl(await readFile(options.decisions, 'utf8')) : null;
  const run = normalizeEvaluationRun(summary, decisions);
  let eligible = [];
  if (options.game != null || options.decision != null) {
    if (options.game == null || options.decision == null) throw new Error('--game and --decision must be used together');
    const game = run.games[options.game - 1]; const event = game?.decisionEvents[options.decision - 1];
    if (!event) throw new Error('Selected game or decision does not exist'); eligible = [event];
  } else {
    eligible = run.decisionEvents.filter(event => !options.disagreementsOnly
      || (event.neuralComparison?.topActionId && event.neuralComparison.topActionId !== event.selectedActionId));
  }
  if (options.actionTypes?.length) eligible = eligible.filter(event => options.actionTypes.includes(event.selectedActionType));
  let manifest = null;
  if (options.sampleManifestInput) {
    const loaded = JSON.parse(await readFile(options.sampleManifestInput, 'utf8'));
    if (loaded.schemaVersion !== 1 || loaded.manifestType !== 'counterfactual-position-sample' || !Array.isArray(loaded.positions)) {
      throw new Error('Unsupported sample manifest');
    }
    manifest = loaded.positions;
  }
  const sampled = sampleCounterfactualPositions(eligible, { strategy: options.sampling, seed: options.samplingSeed,
    limit: options.limit, maxPerMatch: options.maxPerMatch, manifest });
  const targets = sampled.selected;
  process.stdout.write(formatSamplingPreview(sampled.metadata));
  if (options.sampleManifest) await writeFile(options.sampleManifest,
    `${JSON.stringify(createSampleManifest(targets, sampled.metadata), null, 2)}\n`);
  if (options.dryRun) return { schemaVersion: 1, analysisType: 'counterfactual-sample-preview', sampling: sampled.metadata,
    positions: createSampleManifest(targets, sampled.metadata).positions };
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
    evaluationSchemaVersion: run.schemaVersion, sampling: sampled.metadata,
    analysisConfig: { ...config, policyGuidance: 'none', informationMode: 'perfect' }, analyses };
  await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`Wrote ${analyses.length} analyses to ${options.output}\n`);
  return output;
}

export async function main(argv = process.argv.slice(2)) { return analyzeCounterfactualRun(parseCounterfactualArgs(argv)); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Counterfactual analysis failed: ${error.message}\n`); process.exitCode = 1; });
