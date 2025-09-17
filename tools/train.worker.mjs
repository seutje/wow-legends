// Worker that evaluates a candidate model's fitness
import { parentPort } from 'node:worker_threads';

import Game from '../src/js/game.js';
import MLP from '../src/js/systems/nn.js';
import NeuralAI, { setActiveModel } from '../src/js/systems/ai-nn.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { setDebugLogging } from '../src/js/utils/logger.js';
import { RNG } from '../src/js/utils/rng.js';

// Disable debug logging inside the worker as well
setDebugLogging(false);

function sanitizeIterations(value, fallback = 5000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

async function evalCandidate(model, { games = 5, maxRounds = 20, opponentConfig = null } = {}) {
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
    // Deterministic RNG seeds ensure all candidates face identical matchups
    const seed = g >>> 0;
    game.rng = new RNG(seed);
    await game.setupMatch();
    setActiveModel(model);

    const aiOpp = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model });
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
    while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
      await playerAI.takeTurn(game.player, game.opponent);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
      game.resources.startTurn(game.opponent);
      await aiOpp.takeTurn(game.opponent, game.player);
      opponentTurns++;

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
  return total / games;
}

parentPort.on('message', async (msg) => {
  const { id, cmd, payload } = msg || {};
  try {
    if (cmd === 'eval') {
      const { modelJSON, games, maxRounds, opponentConfig } = payload;
      const model = MLP.fromJSON(modelJSON);
      const score = await evalCandidate(model, { games, maxRounds, opponentConfig });
      parentPort.postMessage({ id, ok: true, result: score });
    } else {
      parentPort.postMessage({ id, ok: false, error: `Unknown cmd: ${cmd}` });
    }
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
});
