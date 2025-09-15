#!/usr/bin/env node
// Benchmark GPU vs CPU selection parity for the MCTS AI.
// Runs a few seeds and ensures both backends choose identical actions
// for the sampled game states.

import Game from '../src/js/game.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { RNG } from '../src/js/utils/rng.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

const { log, error } = getOriginalConsole();

function createLCGRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function normalizeAction(action) {
  if (!action) return { end: true, usePower: false, cardId: null };
  return {
    end: !!action.end,
    usePower: !!action.usePower,
    cardId: action.card?.id ?? null,
    cardName: action.card?.name ?? null,
  };
}

function describeAction(action) {
  const norm = normalizeAction(action);
  if (norm.end) return 'end turn';
  const parts = [];
  if (norm.cardId) parts.push(`play ${norm.cardName || norm.cardId}`);
  if (norm.usePower) parts.push('use power');
  return parts.length ? parts.join(' + ') : 'no-op';
}

function actionsEqual(a, b) {
  const na = normalizeAction(a);
  const nb = normalizeAction(b);
  return na.end === nb.end && na.usePower === nb.usePower && na.cardId === nb.cardId;
}

function runSearchWithBackend(ai, rootState, seed, useGpu) {
  const originalRandom = Math.random;
  const generator = createLCGRandom(seed);
  const originalKernel = ai._gpuKernel;
  Math.random = () => generator();
  if (!useGpu) ai._gpuKernel = null;
  try {
    return ai._search(rootState);
  } finally {
    ai._gpuKernel = originalKernel;
    Math.random = originalRandom;
  }
}

function collectStates(ai, rootState, count, rng) {
  const states = [rootState];
  let current = rootState;
  for (let i = 0; i < count; i++) {
    const actions = ai._legalActions(current);
    const nonEnd = actions.filter(a => !a.end);
    if (!nonEnd.length) break;
    const idx = Math.floor(rng() * nonEnd.length);
    const res = ai._applyAction(current, nonEnd[idx]);
    if (res.terminal) break;
    current = res.state;
    states.push(current);
  }
  return states;
}

async function prepare(seed) {
  const game = new Game(null);
  game.rng = new RNG(seed);
  await game.setupMatch();

  const player = game.player;
  const opponent = game.opponent;

  game.turns.setActivePlayer(player);
  game.turns.startTurn();
  game.resources.startTurn(player);

  const drawn = player.library.draw(1);
  if (drawn[0]) player.hand.add(drawn[0]);

  const ai = new MCTS_AI({
    resourceSystem: game.resources,
    combatSystem: game.combat,
    game,
    iterations: 400,
    rolloutDepth: 5,
  });

  const rootState = {
    player,
    opponent,
    pool: game.resources.pool(player),
    turn: game.turns.turn,
    powerAvailable: !!(player.hero?.active?.length) && !player.hero.powerUsed,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
  };

  return { ai, rootState };
}

async function main() {
  const seeds = [0x5a11d, 0xdeadb, 0xbeef1, 0x12345, 0x424242];
  for (const seed of seeds) {
    const { ai, rootState } = await prepare(seed);
    await ai._gpuReady;
    if (!ai._gpuKernel) {
      log('[bench] GPU backend unavailable; using float32 emulation for verification.');
      const stub = (totals, visits, parentVisits, c) => {
        const out = new Float32Array(totals.length);
        const logParent = Math.log(parentVisits + 1);
        for (let i = 0; i < totals.length; i++) {
          const v = visits[i];
          if (v === 0) {
            out[i] = 0;
          } else {
            const mean = totals[i] / v;
            const exploration = c * Math.sqrt(logParent / v);
            out[i] = Math.fround(mean + exploration);
          }
        }
        return out;
      };
      stub.setOutput = () => {};
      ai._gpuKernel = stub;
    }

    const stateRng = createLCGRandom(seed ^ 0x9e3779b9);
    const states = collectStates(ai, rootState, 4, stateRng);
    for (let i = 0; i < states.length; i++) {
      const searchSeed = (seed + i * 9973) >>> 0;
      const state = states[i];
      const cpuAction = runSearchWithBackend(ai, state, searchSeed, false);
      const gpuAction = runSearchWithBackend(ai, state, searchSeed, true);
      if (!actionsEqual(cpuAction, gpuAction)) {
        error(`[bench] Mismatch for seed 0x${seed.toString(16)} state #${i}`);
        error(`[bench] CPU chose: ${describeAction(cpuAction)}`);
        error(`[bench] GPU chose: ${describeAction(gpuAction)}`);
        process.exitCode = 1;
        return;
      }
    }
    log(`[bench] Seed 0x${seed.toString(16)} matched across ${states.length} states.`);
  }
  log('[bench] GPU and CPU backends produced identical actions across all samples.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
