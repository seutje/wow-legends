#!/usr/bin/env node
// Evaluate a single full game.
// Default: NN (player) vs hard MCTS (opponent).
// If a model path argument is provided, pits NN-best (player) vs NN-candidate (opponent).
// Caps at 20 rounds (player+opponent turns). Prints concise results.

import Game from '../src/js/game.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import NeuralAI, { loadModelFromDiskOrFetch, setActiveModel } from '../src/js/systems/ai-nn.js';
import MLP from '../src/js/systems/nn.js';
import { RNG } from '../src/js/utils/rng.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

function fmtResult({ rounds, pHP, pArmor, oHP, oArmor }, pName, oName) {
  const pAlive = pHP > 0;
  const oAlive = oHP > 0;
  let winner = 'draw';
  if (pAlive && !oAlive) winner = `${pName} (player)`;
  else if (!pAlive && oAlive) winner = `${oName} (opponent)`;
  else if (pAlive && oAlive) {
    const diff = (pHP + pArmor) - (oHP + oArmor);
    if (diff > 0) winner = `${pName} (player) — HP advantage`;
    else if (diff < 0) winner = `${oName} (opponent) — HP advantage`;
  }
  return { winner, rounds, player: { hp: pHP, armor: pArmor }, opponent: { hp: oHP, armor: oArmor } };
}

function printCombatLog(outFn, label, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    outFn(`[eval] ${label} log: <empty>`);
    return;
  }
  for (const entry of entries) {
    outFn(`[eval] ${label} log: ${entry}`);
  }
}

async function main() {
  // Optional seed via env or arg; else randomize
  const argSeed = process.env.SEED || process.argv.find(a => a.startsWith('--seed='))?.split('=')[1];
  const seed = argSeed ? Number(argSeed) >>> 0 : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);
  const maxRounds = Number(process.env.MAX_ROUNDS || 20);
  const modelArg = process.argv.slice(2).find(a => !a.startsWith('--'));

  const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
  game.rng = new RNG(seed);
  await game.setupMatch();

  // Load NN model and set active
  const model = await loadModelFromDiskOrFetch();
  setActiveModel(model);

  const nn = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model });
  let opponentAI = null;
  let playerName = 'NN';
  let opponentName = 'MCTS-hard';

  if (modelArg) {
    const fs = await import('fs/promises');
    const url = new URL(`../${modelArg}`, import.meta.url);
    const txt = await fs.readFile(url, 'utf8');
    const obj = JSON.parse(txt);
    const oppModel = MLP.fromJSON(obj);
    opponentAI = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat, model: oppModel });
    playerName = 'NN-best';
    opponentName = 'NN-candidate';
  } else {
    opponentAI = new MCTS_AI({ resourceSystem: game.resources, combatSystem: game.combat, game, iterations: 5000, rolloutDepth: 10, fullSim: true });
  }

  const out = getOriginalConsole().log;

  let rounds = 0;
  while (rounds < maxRounds && game.player.hero.data.health > 0 && game.opponent.hero.data.health > 0) {
    // Player (NN) turn — Game starts with player active
    await nn.takeTurn(game.player, game.opponent);
    if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

    // Opponent turn
    game.turns.setActivePlayer(game.opponent);
    game.turns.startTurn();
    if (!modelArg) game.resources.startTurn(game.opponent);
    await opponentAI.takeTurn(game.opponent, game.player);

    // End of opponent turn -> advance to player's next turn
    while (game.turns.current !== 'End') game.turns.nextPhase();
    game.turns.nextPhase();
    game.turns.setActivePlayer(game.player);
    game.turns.startTurn();
    if (!modelArg) game.resources.startTurn(game.player);

    rounds++;

    const pRoundHP = game.player.hero.data.health;
    const pRoundArmor = game.player.hero.data.armor || 0;
    const oRoundHP = game.opponent.hero.data.health;
    const oRoundArmor = game.opponent.hero.data.armor || 0;
    out(`[eval] Round ${rounds}: ${playerName} HP=${pRoundHP} Armor=${pRoundArmor} | ${opponentName} HP=${oRoundHP} Armor=${oRoundArmor}`);
  }

  const pHP = game.player.hero.data.health;
  const pArmor = game.player.hero.data.armor || 0;
  const oHP = game.opponent.hero.data.health;
  const oArmor = game.opponent.hero.data.armor || 0;
  const summary = fmtResult({ rounds, pHP, pArmor, oHP, oArmor }, playerName, opponentName);

  // Basic action counts for color
  const pPlays = game.player.log.filter(l => l.startsWith('Played ')).length;
  const oPlays = game.opponent.log.filter(l => l.startsWith('Played ')).length;

  // Always print via original console to bypass debug silencing
  out(`[eval] Seed=0x${seed.toString(16)} rounds=${summary.rounds}`);
  out(`[eval] Result: ${summary.winner}`);
  out(`[eval] Player (${playerName}) HP=${pHP} Armor=${pArmor} | Plays=${pPlays}`);
  out(`[eval] Opponent (${opponentName}) HP=${oHP} Armor=${oArmor} | Plays=${oPlays}`);
  printCombatLog(out, `Player (${playerName})`, game.player.log);
  printCombatLog(out, `Opponent (${opponentName})`, game.opponent.log);
}

main().catch(err => { console.error(err); process.exit(1); });
