// Train the neural network AI with simple evolutionary RL.
// - Loads best model from data/models/best.json if present (unless reset)
// - Runs population and generations provided via CLI args
// - Evaluates vs a baseline MCTS opponent with capped steps (or saved NN when requested)
// - Saves best to data/models/best.json

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Game from '../src/js/game.js';
import MLP from '../src/js/systems/nn.js';
import NeuralAI, { setActiveModel } from '../src/js/systems/ai-nn.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { setDebugLogging, getOriginalConsole } from '../src/js/utils/logger.js';
import { parseTrainArgs } from './train.args.mjs';
import { RNG } from '../src/js/utils/rng.js';

// Restrict console output during training to progress reports only
const __originalLog = getOriginalConsole().log;
const __originalInfo = console.info;
const __originalWarning = console.warn;
console.log = function noop() {};
console.info = function noop() {};
console.warn = function noop() {};
function progress(msg) { __originalLog(msg); }

// Ensure any debug logging flags are off in Node context
setDebugLogging(false);

const MODELS_DIR = path.join(__dirname, '..', 'data', 'models');
const MODEL_PATH = path.join(MODELS_DIR, 'best.json');

function now() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const tzMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = tzMin >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzMin) / 60));
  const tzM = pad(Math.abs(tzMin) % 60);
  return `${y}-${mo}-${da}T${h}:${mi}:${s}${sign}${tzH}:${tzM}`;
}

async function loadSavedBest() {
  try {
    const txt = await fs.readFile(MODEL_PATH, 'utf8');
    const obj = JSON.parse(txt);
    return MLP.fromJSON(obj);
  } catch {
    return null;
  }
}

function cloneAndMutate(base, sigma = 0.1) {
  const m = base.clone();
  m.mutate(sigma, 1.0);
  return m;
}

async function evalCandidate(model, { games = 5, maxRounds = 20, opponentMode = 'mcts', opponentModelJSON = null } = {}) {
  const baselineModel = (opponentMode === 'best' && opponentModelJSON)
    ? MLP.fromJSON(opponentModelJSON)
    : null;
  let total = 0;
  for (let g = 0; g < games; g++) {
    const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
    // Randomize RNG seed per evaluation to diversify decks/hands
    const seed = (Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    game.rng = new RNG(seed);
    await game.setupMatch();
    setActiveModel(model); // ensure endTurn or direct AI uses this model

    // Opponent is the candidate NN (controlled directly); player baseline varies by opponent mode
    const aiOpp = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model });
    const playerAI = (baselineModel)
      ? new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model: baselineModel })
      : new MCTS_AI({ resourceSystem: game.resources, combatSystem: game.combat, game, iterations: 5000, rolloutDepth: 10, fullSim: true });

    // Ensure start is player's turn (Game.setupMatch sets player start)
    let rounds = 0;
    while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
      // Player turn
      await playerAI.takeTurn(game.player, game.opponent);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      // Opponent turn
      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
      game.resources.startTurn(game.opponent);
      await aiOpp.takeTurn(game.opponent, game.player);

      // End of opponent turn -> advance to player's next turn
      while (game.turns.current !== 'End') game.turns.nextPhase();
      game.turns.nextPhase();
      game.turns.setActivePlayer(game.player);
      game.turns.startTurn();
      game.resources.startTurn(game.player);

      rounds++;
    }
    const pHP = game.player.hero.data.health;
    const eHP = game.opponent.hero.data.health;
    const neuralWon = (eHP > 0 && pHP <= 0);
    const neuralLost = (eHP <= 0 && pHP > 0);
    // Fitness: reward win highly, loss low, draws/unfinished by HP differential
    const hpDiff = (eHP - pHP) / 40; // positive favors opponent (neural)
    if (neuralWon) total += 2.0;
    else if (neuralLost) total += 0.0;
    else total += 0.5 + hpDiff;
  }
  return total / games;
}

// Parallel evaluation with worker pool
async function evalPopulationParallel(population, { games = 1, maxRounds = 16, concurrency = Math.max(1, (os.cpus()?.length || 2) - 1), opponentMode = 'mcts', opponentModelJSON = null } = {}) {
  const workerURL = new URL('./train.worker.mjs', import.meta.url);
  const poolSize = Math.max(1, Number(process.env.TRAIN_WORKERS) || concurrency);
  const workers = Array.from({ length: poolSize }, () => new Worker(workerURL, { type: 'module' }));
  let nextTask = 0;
  const scores = new Array(population.length);
  let completed = 0;

  function runTaskOn(worker, idx) {
    return new Promise((resolve) => {
      const id = `${idx}-${Math.random().toString(36).slice(2)}`;
      const onMsg = (msg) => {
        if (msg?.id !== id) return;
        worker.off('message', onMsg);
        resolve(msg);
      };
      worker.on('message', onMsg);
      worker.postMessage({
        id,
        cmd: 'eval',
        payload: { modelJSON: population[idx].toJSON(), games, maxRounds, opponentMode, opponentModelJSON }
      });
    });
  }

  async function workerLoop(worker) {
    while (true) {
      const idx = nextTask++;
      if (idx >= population.length) break;
      const res = await runTaskOn(worker, idx);
      if (res?.ok) scores[idx] = res.result;
      else scores[idx] = -Infinity;
      completed++;
      if (completed % 50 === 0) progress(`[${now()}] Evaluated ${completed}/${population.length}`);
    }
  }

  await Promise.all(workers.map(w => workerLoop(w)));
  await Promise.all(workers.map(w => w.terminate()));
  return scores.map((score, idx) => ({ idx, score }));
}

async function main() {
  const { pop: POP, gens: GENS, reset, opponent } = parseTrainArgs();
  await fs.mkdir(MODELS_DIR, { recursive: true });
  const savedBest = await loadSavedBest();
  const base = (reset || !savedBest) ? new MLP([38,64,64,1]) : savedBest.clone();
  const KEEP = Math.max(5, Math.floor(POP * 0.1));
  let best = base.clone();
  let bestScore = -Infinity;

  let opponentMode = opponent;
  let opponentModelJSON = null;
  if (opponent === 'best') {
    if (savedBest) {
      opponentModelJSON = savedBest.toJSON();
    } else {
      progress(`[${now()}] Requested saved-model opponent but ${MODEL_PATH} missing; using MCTS baseline.`);
      opponentMode = 'mcts';
    }
  }

  progress(`[${now()}] Starting training: pop=${POP}, gens=${GENS}, reset=${Boolean(reset)}, opponent=${opponentMode}`);

  for (let gen = 0; gen < GENS; gen++) {
    const population = [];
    population.push(best.clone()); // elitism
    for (let i = 1; i < POP; i++) {
      const sigma = 0.1 * (1 - gen / GENS) + 0.02; // anneal mutation
      population.push(cloneAndMutate(best, sigma));
    }
    // Evaluate in parallel using worker threads
    const scores = await evalPopulationParallel(population, { games: 5, maxRounds: 16, opponentMode, opponentModelJSON });
    scores.sort((a,b)=> b.score - a.score);
    const top = scores.slice(0, KEEP);
    const genBest = population[top[0].idx];
    const genBestScore = top[0].score;
    if (genBestScore > bestScore) { best = genBest.clone(); bestScore = genBestScore; }

    // Save best model for this generation
    try {
      const genPath = path.join(MODELS_DIR, `model_gen_${gen+1}.json`);
      const genJSON = JSON.stringify(genBest.toJSON(), null, 2);
      await fs.writeFile(genPath, genJSON, 'utf8');
      progress(`[${now()}] Gen ${gen+1}/${GENS} best=${genBestScore.toFixed(3)} overall=${bestScore.toFixed(3)} | saved ${genPath}`);
    } catch (e) {
      progress(`[${now()}] Gen ${gen+1}/${GENS} best=${genBestScore.toFixed(3)} overall=${bestScore.toFixed(3)} | failed to save generation model: ${e?.message || e}`);
    }
  }

  // Save best model
  const json = JSON.stringify(best.toJSON(), null, 2);
  await fs.writeFile(MODEL_PATH, json, 'utf8');
  progress(`[${now()}] Saved best model to ${MODEL_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
