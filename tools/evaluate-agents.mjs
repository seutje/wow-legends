import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runSeries, writeEvaluationResults, EVALUATION_AGENT_IDS } from './agent-evaluation.mjs';
import OpenRouterDecisionClient from '../src/js/systems/openrouter-decision-client.js';

const values = new Set(['agent-a', 'agent-b', 'games', 'seed', 'deck-a', 'deck-b',
  'mcts-iterations', 'rollout-depth', 'compare-mcts-every', 'max-turns',
  'max-decisions', 'output-dir', 'max-remote-games']);
const flags = new Set(['mirror', 'no-mirror', 'allow-remote', 'compare-neural', 'no-compare-neural']);

export function parseOptions(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].startsWith('--') ? argv[index].slice(2) : null;
    if (values.has(key)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      args[key] = value;
    } else if (flags.has(key)) args[key] = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  const integer = (key, fallback) => {
    const value = args[key] === undefined ? fallback : Number(args[key]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid --${key}`);
    return value;
  };
  const options = { agentA: args['agent-a'] || 'basic', agentB: args['agent-b'] || 'basic',
    games: integer('games', 2), baseSeed: integer('seed', 1),
    deckA: args['deck-a'] || 'deck1', deckB: args['deck-b'] || args['deck-a'] || 'deck1',
    mirror: !args['no-mirror'], mctsIterations: integer('mcts-iterations', 100),
    rolloutDepth: integer('rollout-depth', 5), compareMctsEvery: integer('compare-mcts-every', 0),
    maxTurns: integer('max-turns', 40), maxDecisions: integer('max-decisions', 1000),
    outputDir: args['output-dir'] || 'data/evaluations',
    allowRemote: !!args['allow-remote'], maxRemoteGames: integer('max-remote-games', 2),
    compareNeural: args['no-compare-neural'] ? false : !!args['compare-neural']
      || args['agent-a'] === 'jev' || args['agent-b'] === 'jev' };
  if (!EVALUATION_AGENT_IDS.includes(options.agentA) || !EVALUATION_AGENT_IDS.includes(options.agentB)) {
    throw new Error(`Agent must be one of: ${EVALUATION_AGENT_IDS.join(', ')}`);
  }
  if (options.games < 1 || options.maxTurns < 1 || options.maxDecisions < 1
    || options.mctsIterations < 1 || options.rolloutDepth < 1
    || (options.mirror && options.games % 2)) throw new Error('Invalid evaluation limits or mirrored game count');
  return options;
}

export function validateRemoteOptions(options, env = process.env) {
  if (options.agentA !== 'jev' && options.agentB !== 'jev') return false;
  if (!options.allowRemote || env.ALLOW_REMOTE_EVALUATION !== '1') {
    throw new Error('Live Jev evaluation requires both --allow-remote and ALLOW_REMOTE_EVALUATION=1');
  }
  if (options.games > options.maxRemoteGames) {
    throw new Error(`Live Jev evaluation is limited to ${options.maxRemoteGames} games; set --max-remote-games explicitly to increase it`);
  }
  return true;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const remote = validateRemoteOptions(options);
  let client = null;
  if (remote) {
    try { process.loadEnvFile?.('.env'); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for live Jev evaluation');
    client = new OpenRouterDecisionClient({ apiKey: process.env.OPENROUTER_API_KEY });
  }
  const { outputDir, allowRemote, maxRemoteGames, ...runOptions } = options;
  const result = await runSeries({ ...runOptions, client,
    ...(client ? { jevModel: client.model } : {}) });
  const basename = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const paths = await writeEvaluationResults(result, outputDir, basename);
  const lines = [`${options.agentA} vs ${options.agentB}`, `Games: ${options.games}`,
    `Completed: ${result.completedGames}; failed: ${result.failedGames}; limited: ${result.limitedGames}`];
  if (result.averageTurns !== null) lines.push(`Average turns: ${result.averageTurns.toFixed(1)}`);
  for (const side of ['A', 'B']) {
    const stats = result.agents[side];
    lines.push(`${side} (${stats.id}): ${stats.wins} wins, ${stats.losses} losses, ${stats.decisions} decisions, ${stats.avgDecisionLatencyMs?.toFixed(1) ?? 'n/a'} ms average`);
  }
  for (const side of ['A', 'B']) {
    const position = result.startingPosition[side];
    lines.push(`${side} first: ${position.wins}/${position.games} wins`);
  }
  if (result.agreement.jevVsNeural !== undefined) lines.push(`Jev / Neural top-action agreement: ${(100 * result.agreement.jevVsNeural).toFixed(1)}%`);
  lines.push(`Summary: ${paths.summaryPath}`, `Decisions: ${paths.decisionsPath}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const secret = process.env.OPENROUTER_API_KEY;
    const message = secret ? String(error.message).replaceAll(secret, '[redacted]') : String(error.message);
    process.stderr.write(`Evaluation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
