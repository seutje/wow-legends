// Worker that evaluates a candidate model's fitness
import { parentPort } from 'node:worker_threads';

import Game from '../src/js/game.js';
import MLP from '../src/js/systems/nn.js';
import NeuralAI, { setActiveModel } from '../src/js/systems/ai-nn.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { loadAutoencoder } from '../src/js/systems/autoencoder.js';
import { setDebugLogging } from '../src/js/utils/logger.js';
import { RNG } from '../src/js/utils/rng.js';
import { decorrelationPenalty, weightL2Norm, DEFAULT_LAMBDA_DECOR, DEFAULT_LAMBDA_L2 } from './regularization.mjs';

// Disable debug logging inside the worker as well
setDebugLogging(false);

function sanitizeIterations(value, fallback = 5000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function attachActivationCollector(model) {
  const hiddenCount = Math.max(0, (Array.isArray(model?.sizes) ? model.sizes.length : 0) - 2);
  const layers = Array.from({ length: hiddenCount }, () => []);
  const originalForward = model.forward;
  model.forward = function patchedForward(input, options) {
    let opts = options;
    if (typeof opts === 'boolean') opts = { collectHidden: opts };
    const wantsHidden = Boolean(opts?.collectHidden || opts?.returnHidden);
    const callOpts = wantsHidden
      ? { ...opts, collectHidden: true }
      : { ...(opts || {}), collectHidden: true };
    const result = originalForward.call(model, input, callOpts);
    const output = Array.isArray(result?.output) ? result.output : (Array.isArray(result) ? result : []);
    const hidden = Array.isArray(result?.hidden) ? result.hidden : [];
    if (hidden.length) {
      hidden.forEach((layer, idx) => {
        if (idx < layers.length && Array.isArray(layer)) {
          layers[idx].push(layer.slice());
        }
      });
    }
    if (wantsHidden) {
      if (Array.isArray(result?.hidden) && Array.isArray(result?.output)) return result;
      return { output, hidden };
    }
    return output;
  };
  return {
    layers,
    restore() {
      model.forward = originalForward;
    }
  };
}

async function evalCandidate(model, { games = 20, maxRounds = 20, opponentConfig = null, lambdaDecor = DEFAULT_LAMBDA_DECOR, lambdaL2 = DEFAULT_LAMBDA_L2 } = {}) {
  try { await loadAutoencoder(); } catch { /* continue with fallback encoding */ }
  const config = opponentConfig || { mode: 'mcts', iterations: 5000, rolloutDepth: 10, fullSim: true };
  const baselineModel = (config.mode === 'best' && config.modelJSON)
    ? MLP.fromJSON(config.modelJSON)
    : null;
  const iterations = sanitizeIterations(config.iterations ?? 5000, 5000);
  const rolloutDepth = Number.isFinite(config.rolloutDepth) ? config.rolloutDepth : 10;
  const fullSim = config.fullSim ?? true;
  let total = 0;
  const collector = attachActivationCollector(model);
  try {
    for (let g = 0; g < games; g++) {
      const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
      if (game?.state) game.state.difficulty = 'nightmare';
      // Deterministic RNG seeds ensure all candidates face identical matchups
      const seed = g >>> 0;
      game.rng = new RNG(seed);
      await game.setupMatch();
      game.turns.setActivePlayer(game.player);
      setActiveModel(model);

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

      let rounds = 0;
      let opponentTurns = 0;
      const playerNeedsResume = playerAI instanceof MCTS_AI;
      let resumePlayerTurn = playerNeedsResume;
      while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
        if (playerNeedsResume) {
          await playerAI.takeTurn(game.player, game.opponent, { resume: resumePlayerTurn });
          resumePlayerTurn = true;
        } else {
          await playerAI.takeTurn(game.player, game.opponent);
        }
        if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

        game.turns.setActivePlayer(game.opponent);
        game.turns.startTurn();
        game.resources.startTurn(game.opponent);
        await opponentAI.takeTurn(game.opponent, game.player);
        opponentTurns++;

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
      const hpDiff = (eHP - pHP) / 40;
      if (neuralWon) {
        const turnsUsed = opponentTurns > 0 ? opponentTurns : rounds;
        const maxTurns = Math.max(1, maxRounds);
        const speedBonus = Math.max(0, (maxRounds - turnsUsed) / maxTurns);
        total += 2.0 + speedBonus;
      }
      else if (neuralLost) total += 0.0;
      else total += 0.5 + hpDiff;
    }
  } finally {
    collector.restore();
  }
  const rawScore = total / games;
  const decorStats = decorrelationPenalty(collector.layers);
  const decorrelation = decorStats.total;
  const l2 = weightL2Norm(model);
  const penalty = lambdaDecor * decorrelation + lambdaL2 * l2;
  const regularizedScore = rawScore - penalty;
  return {
    rawScore,
    regularizedScore,
    penalty,
    decorrelation,
    decorrelationLayers: decorStats.perLayer,
    l2
  };
}

parentPort.on('message', async (msg) => {
  const { id, cmd, payload } = msg || {};
  try {
    if (cmd === 'eval') {
      const { modelJSON, games, maxRounds, opponentConfig, lambdaDecor, lambdaL2 } = payload;
      const model = MLP.fromJSON(modelJSON);
      const score = await evalCandidate(model, { games, maxRounds, opponentConfig, lambdaDecor, lambdaL2 });
      parentPort.postMessage({ id, ok: true, result: score });
    } else {
      parentPort.postMessage({ id, ok: false, error: `Unknown cmd: ${cmd}` });
    }
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
});
