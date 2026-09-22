import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import OpenRouterDecisionClient from '../src/js/systems/openrouter-decision-client.js';

if (existsSync('.env')) loadEnvFile('.env');
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('Set OPENROUTER_API_KEY in the local environment to run this harness.');
  process.exitCode = 1;
} else {
  const client = new OpenRouterDecisionClient({ apiKey });
  const payload = {
    state: { turn: 3, player: { hero: { health: 20 }, resources: { current: 0 }, board: [] },
      opponent: { hero: { health: 2 }, board: [] } },
    actions: [
      { id: 'a0', type: 'end-turn', description: 'End turn' },
      { id: 'a1', type: 'attack', description: 'Attack the enemy hero for 3 damage' },
    ],
  };
  try {
    const result = await client.decide(payload);
    console.log(`Selected action: ${result.actionId}`);
    if (result.metadata.probabilities) console.log(`Probabilities: ${JSON.stringify(result.metadata.probabilities)}`);
    console.log(`Model: ${result.metadata.model}`);
    console.log(`Latency: ${result.metadata.latencyMs}ms`);
  } catch (error) {
    console.error(`OpenRouter decision failed: ${error.code || error.name} (${error.status || 'no HTTP status'})`);
    process.exitCode = 1;
  }
}
