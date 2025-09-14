// Worker that evaluates a candidate model's fitness
import { parentPort } from 'node:worker_threads';

import Game from '../src/js/game.js';
import MLP from '../src/js/systems/nn.js';
import NeuralAI, { setActiveModel } from '../src/js/systems/ai-nn.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { setDebugLogging } from '../src/js/utils/logger.js';

// Disable debug logging inside the worker as well
setDebugLogging(false);

async function evalCandidate(model, { games = 1, maxRounds = 20 } = {}) {
  let total = 0;
  for (let g = 0; g < games; g++) {
    const game = new Game(null);
    await game.setupMatch();
    setActiveModel(model);

    const aiOpp = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model });
    const playerAI = new MCTS_AI({ resourceSystem: game.resources, combatSystem: game.combat, game, iterations: 400, rolloutDepth: 6 });

    let rounds = 0;
    while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
      await playerAI.takeTurn(game.player, game.opponent);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
      game.resources.startTurn(game.opponent);
      await aiOpp.takeTurn(game.opponent, game.player);

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
    if (neuralWon) total += 2.0;
    else if (neuralLost) total += 0.0;
    else total += 0.5 + hpDiff;
  }
  return total / games;
}

parentPort.on('message', async (msg) => {
  const { id, cmd, payload } = msg || {};
  try {
    if (cmd === 'eval') {
      const { modelJSON, games, maxRounds } = payload;
      const model = MLP.fromJSON(modelJSON);
      const score = await evalCandidate(model, { games, maxRounds });
      parentPort.postMessage({ id, ok: true, result: score });
    } else {
      parentPort.postMessage({ id, ok: false, error: `Unknown cmd: ${cmd}` });
    }
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
});
