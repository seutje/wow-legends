#!/usr/bin/env node
// Evaluate one or more full games.
// Default: hard MCTS (player) vs NN-best (opponent).
// If a model path argument is provided, pits NN-candidate (player) vs NN-best (opponent).
// Provide a positive integer as the final argument to run multiple matches.
// Caps at 20 rounds (player+opponent turns). Prints concise results.

import Game from '../src/js/game.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import NeuralAI, { loadModelFromDiskOrFetch, setActiveModel } from '../src/js/systems/ai-nn.js';
import MLP from '../src/js/systems/nn.js';
import { loadAutoencoder } from '../src/js/systems/autoencoder.js';
import { RNG } from '../src/js/utils/rng.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

function fmtResult({ rounds, pHP, pArmor, oHP, oArmor, startingPlayer }, pName, oName) {
  const pAlive = pHP > 0;
  const oAlive = oHP > 0;
  let winner = 'draw';
  let winnerKey = 'draw';
  if (pAlive && !oAlive) {
    winner = `${pName} (player)`;
    winnerKey = 'player';
  } else if (!pAlive && oAlive) {
    winner = `${oName} (opponent)`;
    winnerKey = 'opponent';
  } else if (pAlive && oAlive) {
    const diff = (pHP + pArmor) - (oHP + oArmor);
    if (diff > 0) {
      winner = `${pName} (player) — HP advantage`;
      winnerKey = 'player';
    } else if (diff < 0) {
      winner = `${oName} (opponent) — HP advantage`;
      winnerKey = 'opponent';
    }
  }
  return {
    winner,
    winnerKey,
    rounds,
    startingPlayer,
    player: { hp: pHP, armor: pArmor },
    opponent: { hp: oHP, armor: oArmor }
  };
}

function attachCombatLogPrinter(outFn, label, entries) {
  if (!Array.isArray(entries)) {
    return () => {};
  }

  let printedAny = false;
  const originalPush = entries.push.bind(entries);

  const printEntry = (entry) => {
    outFn(`[eval] ${label} log: ${entry}`);
    printedAny = true;
  };

  for (const entry of entries) {
    printEntry(entry);
  }

  entries.push = function pushWithLogging(...items) {
    for (const entry of items) {
      printEntry(entry);
    }
    return originalPush(...items);
  };

  return () => {
    if (!printedAny) {
      outFn(`[eval] ${label} log: <empty>`);
    }
  };
}

async function playMatch({ matchSeed, maxRounds, bestModel, candidateModel, playerName, opponentName, logDetails, out }) {
  const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
  game.rng = new RNG(matchSeed);
  await game.setupMatch();
  const startingPlayerKey = game.state?.startingPlayer === 'opponent' ? 'opponent' : 'player';

  const playerUsesMcts = !candidateModel;
  const playerAI = playerUsesMcts
    ? new MCTS_AI({ resourceSystem: game.resources, combatSystem: game.combat, game, iterations: 5000, rolloutDepth: 10, fullSim: true })
    : new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model: candidateModel });
  const opponentAI = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model: bestModel });

  let finalizePlayerLog = () => {};
  let finalizeOpponentLog = () => {};

  if (logDetails) {
    const playerHeroName = game.player?.hero?.name || 'Unknown Hero';
    const opponentHeroName = game.opponent?.hero?.name || 'Unknown Hero';

    out(`[eval] Player AI ${playerName} controls hero ${playerHeroName}`);
    out(`[eval] Opponent AI ${opponentName} controls hero ${opponentHeroName}`);
    const firstMoverName = startingPlayerKey === 'player' ? playerName : opponentName;
    out(`[eval] Starting player: ${firstMoverName} (${startingPlayerKey})`);

    finalizePlayerLog = attachCombatLogPrinter(out, `Player (${playerName})`, game.player.log);
    finalizeOpponentLog = attachCombatLogPrinter(out, `Opponent (${opponentName})`, game.opponent.log);
  }

  let rounds = 0;
  let playerTurns = 0;
  let pendingTurnIncrement = startingPlayerKey === 'opponent';
  while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
    if (game.turns.activePlayer === game.player) {
      await playerAI.takeTurn(game.player, game.opponent);
      playerTurns += 1;
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      if (pendingTurnIncrement) {
        game.turns.turn += 1;
        pendingTurnIncrement = false;
      }

      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
      await opponentAI.takeTurn(game.opponent, game.player);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      while (game.turns.current !== 'End') game.turns.nextPhase();
      game.turns.nextPhase();
      game.turns.setActivePlayer(game.player);
      game.turns.startTurn();
      if (playerUsesMcts) game.resources.startTurn(game.player);
    } else {
      await opponentAI.takeTurn(game.opponent, game.player);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      if (playerTurns === 0) {
        await game._finalizeOpponentTurn({ preserveTurn: true });
        pendingTurnIncrement = true;
        if (playerUsesMcts) game.resources.startTurn(game.player);
      } else {
        while (game.turns.current !== 'End') game.turns.nextPhase();
        game.turns.nextPhase();
        game.turns.setActivePlayer(game.player);
        game.turns.startTurn();
        if (playerUsesMcts) game.resources.startTurn(game.player);
      }

      await playerAI.takeTurn(game.player, game.opponent);
      playerTurns += 1;
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      if (pendingTurnIncrement) {
        game.turns.turn += 1;
        pendingTurnIncrement = false;
      }

      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
    }

    rounds++;

    if (logDetails) {
      const pRoundHP = game.player.hero.data.health;
      const pRoundArmor = game.player.hero.data.armor || 0;
      const oRoundHP = game.opponent.hero.data.health;
      const oRoundArmor = game.opponent.hero.data.armor || 0;
      out(`[eval] Round ${rounds}: ${playerName} HP=${pRoundHP} Armor=${pRoundArmor} | ${opponentName} HP=${oRoundHP} Armor=${oRoundArmor}`);
    }
  }

  const pHP = game.player.hero.data.health;
  const pArmor = game.player.hero.data.armor || 0;
  const oHP = game.opponent.hero.data.health;
  const oArmor = game.opponent.hero.data.armor || 0;
  const summary = fmtResult({ rounds, pHP, pArmor, oHP, oArmor, startingPlayer: startingPlayerKey }, playerName, opponentName);

  if (logDetails) {
    const pPlays = game.player.log.filter(l => l.startsWith('Played ')).length;
    const oPlays = game.opponent.log.filter(l => l.startsWith('Played ')).length;

    out(`[eval] Seed=0x${matchSeed.toString(16)} rounds=${summary.rounds}`);
    out(`[eval] Result: ${summary.winner}`);
    out(`[eval] Player (${playerName}) HP=${pHP} Armor=${pArmor} | Plays=${pPlays}`);
    out(`[eval] Opponent (${opponentName}) HP=${oHP} Armor=${oArmor} | Plays=${oPlays}`);
  }

  finalizePlayerLog();
  finalizeOpponentLog();

  return summary;
}

async function main() {
  const argSeed = process.env.SEED || process.argv.find(a => a.startsWith('--seed='))?.split('=')[1];
  const baseSeed = argSeed ? Number(argSeed) >>> 0 : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);
  const maxRounds = Number(process.env.MAX_ROUNDS || 20);

  const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
  let modelArg = null;
  let matchCount = 1;
  let matchCountProvided = false;
  const digitsOnly = /^\d+$/;

  for (const arg of positionalArgs) {
    if (digitsOnly.test(arg)) {
      if (matchCountProvided) {
        throw new Error(`[eval] Unexpected extra match count argument: ${arg}`);
      }
      matchCount = Number(arg);
      matchCountProvided = true;
      continue;
    }
    if (!modelArg) {
      modelArg = arg;
      continue;
    }
    throw new Error(`[eval] Unexpected positional argument: ${arg}`);
  }

  if (!Number.isInteger(matchCount) || matchCount < 1) {
    throw new Error('[eval] Match count must be a positive integer');
  }

  try { await loadAutoencoder(); } catch { /* fall back to zeroed latent vectors */ }
  const bestModel = await loadModelFromDiskOrFetch();
  setActiveModel(bestModel);

  let candidateModel = null;
  if (modelArg) {
    const fs = await import('fs/promises');
    const url = new URL(`../${modelArg}`, import.meta.url);
    const txt = await fs.readFile(url, 'utf8');
    const obj = JSON.parse(txt);
    candidateModel = MLP.fromJSON(obj);
  }

  const playerName = modelArg ? 'NN-candidate' : 'MCTS-hard';
  const opponentName = 'NN-best';

  const out = getOriginalConsole().log;
  const logDetails = matchCount === 1;

  const totals = { player: 0, opponent: 0, draw: 0 };

  for (let i = 0; i < matchCount; i++) {
    const matchSeed = (baseSeed + i) >>> 0;
    const summary = await playMatch({
      matchSeed,
      maxRounds,
      bestModel,
      candidateModel,
      playerName,
      opponentName,
      logDetails,
      out,
    });

    if (summary.winnerKey === 'player') totals.player += 1;
    else if (summary.winnerKey === 'opponent') totals.opponent += 1;
    else totals.draw += 1;

    if (!logDetails) {
      const firstMoverName = summary.startingPlayer === 'player' ? playerName : opponentName;
      out(`[eval] Match ${i + 1}/${matchCount}: ${summary.winner} (first: ${firstMoverName})`);
    }
  }

  if (!logDetails) {
    const playerWins = totals.player;
    const opponentWins = totals.opponent;
    const draws = totals.draw;
    const playerWinRate = playerWins / matchCount;
    const opponentWinRate = opponentWins / matchCount;
    const drawRate = draws / matchCount;

    if (playerWins === opponentWins) {
      out(`[eval] Overall result: draw — both ${playerName} and ${opponentName} won ${(playerWinRate * 100).toFixed(1)}% of matches; draws ${(drawRate * 100).toFixed(1)}%.`);
    } else {
      const overallWinner = playerWins > opponentWins ? playerName : opponentName;
      const overallLoser = playerWins > opponentWins ? opponentName : playerName;
      const winnerRate = playerWins > opponentWins ? playerWinRate : opponentWinRate;
      const loserRate = playerWins > opponentWins ? opponentWinRate : playerWinRate;
      const margin = (winnerRate - loserRate) * 100;
      out(`[eval] Overall winner: ${overallWinner} with ${(winnerRate * 100).toFixed(1)}% wins (+${margin.toFixed(1)}% vs ${overallLoser}; draws ${(drawRate * 100).toFixed(1)}%).`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
