// Train the neural network AI with simple evolutionary RL.
// - Loads best model from data/models/best.json if present (unless reset)
// - Runs population and generations provided via CLI args
// - Evaluates vs a baseline MCTS opponent with capped steps (or saved NN when requested)
// - Supports opponent curricula (--curriculum) to ramp difficulty as scores improve
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
import NeuralAI, { setActiveModel, DEFAULT_MODEL_SHAPE, MODEL_INPUT_SIZE } from '../src/js/systems/ai-nn.js';
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

function sanitizeIterations(value, fallback = 5000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function formatIterations(iterations) {
  return Number.isFinite(iterations)
    ? iterations.toLocaleString('en-US')
    : String(iterations);
}

const NAMED_MCTS_LEVELS = {
  weak: 1200,
  easy: 1500,
  medium: 2500,
  strong: 4000,
  hard: 5500,
  brutal: 8000
};

function parseOpponentDescriptorToken(token, { baseIterations = 5000 } = {}) {
  const raw = token == null ? '' : String(token).trim();
  if (!raw) {
    const iterations = sanitizeIterations(baseIterations);
    return {
      kind: 'mcts',
      iterations,
      label: `MCTS ${formatIterations(iterations)} iterations`
    };
  }
  const text = raw.toLowerCase();
  if (/^(best|saved|nn|model)$/.test(text)) {
    const fallbackIterations = sanitizeIterations(baseIterations);
    return {
      kind: 'best',
      label: 'Saved best NN opponent',
      fallbackIterations
    };
  }
  if (Object.prototype.hasOwnProperty.call(NAMED_MCTS_LEVELS, text)) {
    const iterations = sanitizeIterations(NAMED_MCTS_LEVELS[text], baseIterations);
    return {
      kind: 'mcts',
      iterations,
      label: `MCTS ${formatIterations(iterations)} iterations (${text})`
    };
  }
  const mctsMatch = text.match(/^mcts(?:[@:](\d+))?$/);
  if (mctsMatch) {
    const iterations = sanitizeIterations(mctsMatch[1] ? Number.parseInt(mctsMatch[1], 10) : baseIterations, baseIterations);
    return {
      kind: 'mcts',
      iterations,
      label: `MCTS ${formatIterations(iterations)} iterations`
    };
  }
  if (/^\d+$/.test(text)) {
    const iterations = sanitizeIterations(Number.parseInt(text, 10), baseIterations);
    return {
      kind: 'mcts',
      iterations,
      label: `MCTS ${formatIterations(iterations)} iterations`
    };
  }
  return {
    kind: 'mcts',
    iterations: sanitizeIterations(baseIterations),
    label: `MCTS ${formatIterations(sanitizeIterations(baseIterations))} iterations`
  };
}

function descriptorBaseIterations(descriptor) {
  if (!descriptor) return 5000;
  if (descriptor.kind === 'mcts') return sanitizeIterations(descriptor.iterations ?? 5000, 5000);
  if (descriptor.kind === 'best') return sanitizeIterations(descriptor.fallbackIterations ?? descriptor.iterations ?? 5000, 5000);
  return 5000;
}

function buildGentleSchedule(baseDescriptor) {
  const baseIterations = descriptorBaseIterations(baseDescriptor);
  const early = sanitizeIterations(Math.max(400, Math.round(baseIterations * 0.35)), baseIterations);
  const mid = sanitizeIterations(Math.max(600, Math.round(baseIterations * 0.6)), baseIterations);
  const schedule = [
    {
      threshold: 0,
      descriptor: {
        kind: 'mcts',
        iterations: early,
        label: `MCTS ${formatIterations(early)} iterations (curriculum: gentle start)`
      }
    },
    {
      threshold: 0.8,
      descriptor: {
        kind: 'mcts',
        iterations: mid,
        label: `MCTS ${formatIterations(mid)} iterations (curriculum: ramp)`
      }
    }
  ];
  if (baseDescriptor?.kind === 'best') {
    const full = sanitizeIterations(baseDescriptor.fallbackIterations ?? baseIterations, baseIterations);
    schedule.push({
      threshold: 1.4,
      descriptor: {
        kind: 'mcts',
        iterations: full,
        label: `MCTS ${formatIterations(full)} iterations (curriculum: full baseline)`
      }
    });
    schedule.push({
      threshold: 1.9,
      descriptor: baseDescriptor
    });
  } else {
    schedule.push({
      threshold: 1.6,
      descriptor: baseDescriptor
    });
  }
  return schedule;
}

function parseCurriculumSchedule(spec, baseDescriptor) {
  if (!spec) return null;
  const trimmed = String(spec).trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'gentle' || lowered === 'default') {
    return buildGentleSchedule(baseDescriptor);
  }

  const baseIterations = descriptorBaseIterations(baseDescriptor);
  const stages = trimmed.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf(':');
    if (idx <= 0) throw new Error(`Invalid curriculum stage "${part}"; expected <threshold>:<opponent>`);
    const thresholdText = part.slice(0, idx).trim();
    const opponentText = part.slice(idx + 1).trim();
    if (!opponentText) throw new Error(`Missing opponent descriptor in stage "${part}"`);
    const threshold = Number.parseFloat(thresholdText);
    if (!Number.isFinite(threshold)) throw new Error(`Invalid threshold "${thresholdText}" in stage "${part}"`);
    const descriptor = parseOpponentDescriptorToken(opponentText, { baseIterations });
    if (descriptor.kind === 'best' && descriptor.fallbackIterations == null) {
      descriptor.fallbackIterations = descriptorBaseIterations(baseDescriptor);
    }
    return { threshold, descriptor };
  });
  stages.sort((a, b) => a.threshold - b.threshold);
  return stages;
}

function descriptorToConfig(descriptor, { savedBestJSON } = {}) {
  if (!descriptor) {
    const iterations = 5000;
    return {
      mode: 'mcts',
      label: `MCTS ${formatIterations(iterations)} iterations`,
      iterations,
      rolloutDepth: 10,
      fullSim: true
    };
  }
  if (descriptor.kind === 'best') {
    if (savedBestJSON) {
      return {
        mode: 'best',
        label: descriptor.label ?? 'Saved best NN opponent',
        modelJSON: savedBestJSON,
        rolloutDepth: descriptor.rolloutDepth ?? 10,
        fullSim: descriptor.fullSim ?? true,
        iterations: descriptorBaseIterations(descriptor)
      };
    }
    const fallbackIterations = descriptorBaseIterations(descriptor);
    return {
      mode: 'mcts',
      label: `${descriptor.label ?? 'Saved best NN opponent'} (fallback to MCTS ${formatIterations(fallbackIterations)} iterations; saved model missing)`,
      iterations: fallbackIterations,
      rolloutDepth: descriptor.rolloutDepth ?? 10,
      fullSim: descriptor.fullSim ?? true
    };
  }
  const iterations = sanitizeIterations(descriptor.iterations ?? 5000, 5000);
  return {
    mode: 'mcts',
    label: descriptor.label ?? `MCTS ${formatIterations(iterations)} iterations`,
    iterations,
    rolloutDepth: descriptor.rolloutDepth ?? 10,
    fullSim: descriptor.fullSim ?? true
  };
}

function describeCurriculum(schedule, context = {}) {
  if (!Array.isArray(schedule) || schedule.length === 0) return '';
  return schedule.map((entry, idx) => {
    const cfg = descriptorToConfig(entry.descriptor, context);
    const threshold = Number.isFinite(entry.threshold)
      ? (idx === 0 ? 'start' : `>= ${entry.threshold.toFixed(2)}`)
      : 'start';
    return `${threshold}: ${cfg.label}`;
  }).join(' | ');
}

function pickCurriculumStage(schedule, score) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  let chosen = schedule[0];
  for (const entry of schedule) {
    if (score >= entry.threshold) chosen = entry;
    else break;
  }
  return chosen;
}

async function evalCandidate(model, { games = 20, maxRounds = 20, opponentConfig = null } = {}) {
  const config = opponentConfig || { mode: 'mcts', iterations: 5000, rolloutDepth: 10, fullSim: true };
  const baselineModel = (config.mode === 'best' && config.modelJSON)
    ? MLP.fromJSON(config.modelJSON)
    : null;
  const iterations = sanitizeIterations(config.iterations ?? 5000, 5000);
  const rolloutDepth = Number.isFinite(config.rolloutDepth) ? config.rolloutDepth : 10;
  const fullSim = config.fullSim ?? true;
  let total = 0;
  for (let g = 0; g < games; g++) {
    const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
    if (game?.state) game.state.difficulty = 'nightmare';
    // Use deterministic RNG seeds per evaluation so every candidate sees identical matchups
    const seed = g >>> 0;
    game.rng = new RNG(seed);
    await game.setupMatch();
    game.turns.setActivePlayer(game.player);
    setActiveModel(model); // ensure endTurn or direct AI uses this model

    // Candidate network always pilots the opponent side; baseline controls the player side
    const opponentAI = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model });
    const playerAI = (baselineModel)
      ? new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model: baselineModel })
      : new MCTS_AI({
        resourceSystem: game.resources,
        combatSystem: game.combat,
        game,
        iterations,
        rolloutDepth,
        fullSim
      });

    // Ensure start is player's turn (Game.setupMatch sets player start)
    let rounds = 0;
    let opponentTurns = 0;
    const playerNeedsResume = playerAI instanceof MCTS_AI;
    let resumePlayerTurn = playerNeedsResume;
    while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
      // Player turn (baseline controller)
      if (playerNeedsResume) {
        await playerAI.takeTurn(game.player, game.opponent, { resume: resumePlayerTurn });
        resumePlayerTurn = true;
      } else {
        await playerAI.takeTurn(game.player, game.opponent);
      }
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      // Opponent turn
      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
      game.resources.startTurn(game.opponent);
      await opponentAI.takeTurn(game.opponent, game.player);
      opponentTurns++;

      // End of opponent turn -> advance to player's next turn
      while (game.turns.current !== 'End') game.turns.nextPhase();
      game.turns.nextPhase();
      game.turns.setActivePlayer(game.player);
      game.turns.startTurn();
      game.resources.startTurn(game.player);
      resumePlayerTurn = playerNeedsResume ? true : resumePlayerTurn;

      rounds++;
    }
    const pHP = game.player.hero.data.health;
    const eHP = game.opponent.hero.data.health;
    const neuralWon = (eHP > 0 && pHP <= 0);
    const neuralLost = (eHP <= 0 && pHP > 0);
    // Fitness: reward win highly, loss low, draws/unfinished by HP differential
    const hpDiff = (eHP - pHP) / 40; // positive favors opponent (neural)
    if (neuralWon) {
      const turnsUsed = opponentTurns > 0 ? opponentTurns : rounds;
      const maxTurns = Math.max(1, maxRounds);
      const speedBonus = Math.max(0, (maxRounds - turnsUsed) / maxTurns);
      total += 2.0 + speedBonus;
    }
    else if (neuralLost) total += 0.0;
    else total += 0.5 + hpDiff;
  }
  return total / games;
}

// Parallel evaluation with worker pool
async function evalPopulationParallel(population, { games = 1, maxRounds = 16, concurrency = Math.max(1, (os.cpus()?.length || 2) - 1), opponentConfig = null } = {}) {
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
        payload: { modelJSON: population[idx].toJSON(), games, maxRounds, opponentConfig }
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
  const { pop: POP, gens: GENS, reset, opponent, curriculum } = parseTrainArgs();
  await fs.mkdir(MODELS_DIR, { recursive: true });
  let savedBest = await loadSavedBest();
  if (savedBest && (!Array.isArray(savedBest.sizes) || savedBest.sizes[0] !== MODEL_INPUT_SIZE)) {
    progress(`[${now()}] Saved model input size ${savedBest?.sizes?.[0]} does not match expected ${MODEL_INPUT_SIZE}; ignoring saved checkpoint.`);
    savedBest = null;
  }
  const savedBestJSON = savedBest ? savedBest.toJSON() : null;
  const base = (reset || !savedBest) ? new MLP(DEFAULT_MODEL_SHAPE) : savedBest.clone();
  const networkShape = base.sizes.slice();
  const KEEP = Math.max(5, Math.floor(POP * 0.1));
  const effectiveGens = Math.max(1, GENS);
  const mutationSigma = (generationIndex) => 0.1 * (1 - generationIndex / effectiveGens) + 0.02;
  let best = base.clone();
  let bestScore = -Infinity;
  let population = [];
  const initialSigma = mutationSigma(0);
  const plateauThreshold = Math.max(3, Math.min(10, Math.floor(effectiveGens * 0.1)));
  let plateauStreak = 0;
  let plateauActive = false;
  population.push(best.clone());
  for (let i = 1; i < POP; i++) {
    population.push(cloneAndMutate(best, initialSigma));
  }

  const baseDescriptor = parseOpponentDescriptorToken(opponent, { baseIterations: 5000 });
  const scheduleContext = { savedBestJSON };
  let curriculumSchedule = null;
  if (curriculum) {
    try {
      curriculumSchedule = parseCurriculumSchedule(curriculum, baseDescriptor);
      if (!curriculumSchedule || curriculumSchedule.length === 0) {
        curriculumSchedule = null;
        progress(`[${now()}] Curriculum "${curriculum}" did not yield any stages; using static opponent.`);
      }
    } catch (err) {
      curriculumSchedule = null;
      progress(`[${now()}] Failed to parse curriculum "${curriculum}": ${err?.message || err}; using static opponent.`);
    }
  }

  const usesSavedOpponent = baseDescriptor.kind === 'best'
    || (curriculumSchedule?.some((stage) => stage.descriptor?.kind === 'best'));
  if (!savedBest && usesSavedOpponent) {
    progress(`[${now()}] Requested saved-model opponent but ${MODEL_PATH} missing; using MCTS fallback until a model is saved.`);
  }

  let activeStage = curriculumSchedule ? pickCurriculumStage(curriculumSchedule, -Infinity) : null;
  let activeOpponentConfig = descriptorToConfig(activeStage ? activeStage.descriptor : baseDescriptor, scheduleContext);
  let encounteredBestOpponent = activeOpponentConfig.mode === 'best';

  progress(`[${now()}] Starting training: pop=${POP}, gens=${GENS}, reset=${Boolean(reset)}, opponent=${activeOpponentConfig.label}`);
  if (curriculumSchedule) {
    const summary = describeCurriculum(curriculumSchedule, scheduleContext);
    progress(`[${now()}] Opponent curriculum (${curriculum}): ${summary}`);
  }

  for (let gen = 0; gen < GENS; gen++) {
    if (activeOpponentConfig.mode === 'best') {
      encounteredBestOpponent = true;
    }
    // Evaluate in parallel using worker threads
    const scores = await evalPopulationParallel(population, { games: 5, maxRounds: 16, opponentConfig: activeOpponentConfig });
    scores.sort((a,b)=> b.score - a.score);
    const top = scores.slice(0, KEEP);
    const parents = top.map(({ idx }) => population[idx].clone());
    if (parents.length === 0) {
      progress(`[${now()}] Gen ${gen+1}/${GENS} produced no valid parents; stopping early.`);
      break;
    }
    const genBest = parents[0];
    const genBestScore = top[0].score;
    const improved = genBestScore > bestScore;
    if (improved) { best = genBest.clone(); bestScore = genBestScore; }

    const wasPlateau = plateauActive;
    if (improved) {
      plateauStreak = 0;
      plateauActive = false;
      if (wasPlateau) {
        progress(`[${now()}] Plateau broken at gen ${gen+1}; restoring baseline exploration.`);
      }
    } else {
      plateauStreak += 1;
      if (!plateauActive && plateauStreak >= plateauThreshold) {
        plateauActive = true;
        progress(`[${now()}] Plateau detected after ${plateauStreak} generations without improvement; increasing exploration.`);
      }
    }

    // Save best model for this generation
    try {
      const genPath = path.join(MODELS_DIR, `model_gen_${gen+1}.json`);
      const genJSON = JSON.stringify(genBest.toJSON(), null, 2);
      await fs.writeFile(genPath, genJSON, 'utf8');
      progress(`[${now()}] Gen ${gen+1}/${GENS} best=${genBestScore.toFixed(3)} overall=${bestScore.toFixed(3)} | opponent=${activeOpponentConfig.label} | saved ${genPath}`);
    } catch (e) {
      progress(`[${now()}] Gen ${gen+1}/${GENS} best=${genBestScore.toFixed(3)} overall=${bestScore.toFixed(3)} | opponent=${activeOpponentConfig.label} | failed to save generation model: ${e?.message || e}`);
    }

    if (curriculumSchedule) {
      const nextStage = pickCurriculumStage(curriculumSchedule, bestScore);
      if (nextStage !== activeStage) {
        activeStage = nextStage;
        const previousLabel = activeOpponentConfig.label;
        activeOpponentConfig = descriptorToConfig(activeStage.descriptor, scheduleContext);
        if (activeOpponentConfig.mode === 'best') {
          encounteredBestOpponent = true;
        }
        const thresholdText = Number.isFinite(activeStage.threshold)
          ? `>= ${activeStage.threshold.toFixed(2)}`
          : 'final';
        progress(`[${now()}] Curriculum update: best score ${bestScore.toFixed(3)} reached ${thresholdText}; opponent ${previousLabel} -> ${activeOpponentConfig.label}`);
      }
    }

    if (gen < GENS - 1) {
      const nextPopulation = [];
      for (let i = 0; i < parents.length && nextPopulation.length < POP; i++) {
        nextPopulation.push(parents[i].clone());
      }
      const baseSigma = mutationSigma(gen + 1);
      const adaptiveSigma = plateauActive ? Math.min(0.5, baseSigma * 2) : baseSigma;
      let freshCount = plateauActive ? Math.max(1, Math.floor(POP * 0.05)) : 0;
      let remainingSlots = Math.max(0, POP - nextPopulation.length);
      if (freshCount > remainingSlots) freshCount = remainingSlots;
      const targetBeforeFresh = POP - freshCount;
      if (plateauActive) {
        progress(`[${now()}] Gen ${gen+1}/${GENS} plateau streak=${plateauStreak}; using sigma=${adaptiveSigma.toFixed(3)} and reserving ${freshCount} fresh models.`);
      }
      let idx = 0;
      while (nextPopulation.length < targetBeforeFresh) {
        const parent = parents[idx % parents.length];
        nextPopulation.push(cloneAndMutate(parent, adaptiveSigma));
        idx++;
      }
      for (let i = 0; i < freshCount && nextPopulation.length < POP; i++) {
        nextPopulation.push(new MLP(networkShape));
      }
      population = nextPopulation;
    }
  }

  // Save best model
  const shouldSaveBest = !encounteredBestOpponent || bestScore > 2.0;
  if (shouldSaveBest) {
    const json = JSON.stringify(best.toJSON(), null, 2);
    await fs.writeFile(MODEL_PATH, json, 'utf8');
    progress(`[${now()}] Saved best model to ${MODEL_PATH}`);
  } else {
    const formattedScore = Number.isFinite(bestScore) ? bestScore.toFixed(3) : String(bestScore);
    progress(`[${now()}] Best score ${formattedScore} did not exceed 2.000 against saved opponent; skipping save to ${MODEL_PATH}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
