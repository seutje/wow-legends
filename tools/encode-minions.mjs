#!/usr/bin/env node
// Sample simulated matches to gather per-minion feature vectors for autoencoder training.
// Outputs data/datasets/minion-encodings.json with the collected vectors.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import Game from '../src/js/game.js';
import { BasicAI } from '../src/js/systems/ai.js';
import { RNG } from '../src/js/utils/rng.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'datasets');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'minion-encodings.json');

const FEATURE_COLUMNS = Object.freeze([
  'attack',
  'health',
  'taunt',
  'rush',
  'stealth',
  'divineShield',
  'windfury',
  'reflect',
  'lifesteal'
]);

const DEFAULT_GAMES = 24;
const DEFAULT_ROUNDS = 12; // full rounds (player+opponent)

function parseCliArgs(argv = process.argv.slice(2)) {
  const cfg = { games: DEFAULT_GAMES, rounds: DEFAULT_ROUNDS };
  for (const token of argv) {
    if (!token) continue;
    if (token === '--help' || token === '-h') {
      cfg.help = true;
      continue;
    }
    if (token.startsWith('--games=')) {
      const value = Number.parseInt(token.split('=')[1], 10);
      if (Number.isFinite(value) && value > 0) cfg.games = value;
      continue;
    }
    if (token.startsWith('--rounds=')) {
      const value = Number.parseInt(token.split('=')[1], 10);
      if (Number.isFinite(value) && value > 0) cfg.rounds = value;
      continue;
    }
    if (!token.startsWith('--')) {
      const numeric = Number.parseInt(token, 10);
      if (Number.isFinite(numeric) && numeric > 0) {
        if (!cfg._positionalGames) {
          cfg.games = numeric;
          cfg._positionalGames = true;
          continue;
        }
        if (!cfg._positionalRounds) {
          cfg.rounds = numeric;
          cfg._positionalRounds = true;
          continue;
        }
      }
    }
  }
  return cfg;
}

function listCards(zone) {
  if (!zone) return [];
  if (Array.isArray(zone)) return zone.filter(Boolean);
  if (Array.isArray(zone.cards)) return zone.cards.filter(Boolean);
  if (typeof zone.size === 'function' && Array.isArray(zone.cards)) return zone.cards.filter(Boolean);
  return [];
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function keywordActive(card, keyword) {
  if (!card) return false;
  if (Array.isArray(card.keywords) && card.keywords.includes(keyword)) return true;
  const temp = card?.data?.tempKeywordCounts;
  if (temp && numberOrZero(temp[keyword]) > 0) return true;
  return false;
}

function divineShieldActive(card) {
  if (!card) return false;
  if (card?.data?.divineShield === true) return true;
  if (card?.data?.divineShield === false) return false;
  return keywordActive(card, 'Divine Shield');
}

function minionFeatureVector(card) {
  const data = card?.data || {};
  const attack = numberOrZero(data.attack ?? card?.attack);
  const health = numberOrZero(data.health ?? card?.health);
  const taunt = keywordActive(card, 'Taunt') ? 1 : 0;
  const rush = keywordActive(card, 'Rush') ? 1 : 0;
  const stealth = keywordActive(card, 'Stealth') ? 1 : 0;
  const divineShield = divineShieldActive(card) ? 1 : 0;
  const windfury = keywordActive(card, 'Windfury') ? 1 : 0;
  const reflect = keywordActive(card, 'Reflect') ? 1 : 0;
  const lifesteal = keywordActive(card, 'Lifesteal') ? 1 : 0;
  return [attack, health, taunt, rush, stealth, divineShield, windfury, reflect, lifesteal];
}

function collectSideSamples(side, owner, output, traitPresence, latentColumns = FEATURE_COLUMNS) {
  const battlefield = listCards(side?.battlefield);
  for (const card of battlefield) {
    if (!card || card.type !== 'ally') continue;
    if (card?.data?.dead) continue;
    const vector = minionFeatureVector(card);
    output.push({
      cardId: typeof card.id === 'string' ? card.id : null,
      owner,
      heroId: typeof side?.hero?.id === 'string' ? side.hero.id : null,
      vector
    });
    for (let i = 0; i < vector.length && i < traitPresence.length; i++) {
      if (vector[i] > 0) traitPresence[i] = true;
    }
  }
}

function syntheticVectorFor(keyword) {
  const base = [3, 4, 0, 0, 0, 0, 0, 0, 0];
  switch (keyword) {
    case 'taunt': base[2] = 1; break;
    case 'rush': base[3] = 1; break;
    case 'stealth': base[4] = 1; break;
    case 'divineShield': base[5] = 1; break;
    case 'windfury': base[6] = 1; break;
    case 'reflect': base[7] = 1; break;
    case 'lifesteal': base[8] = 1; break;
    default: break;
  }
  return base;
}

async function simulateAndCollect({ games, rounds }) {
  const samples = [];
  const traitPresence = new Array(FEATURE_COLUMNS.length).fill(false);
  let cardIndex = null;
  for (let g = 0; g < games; g++) {
    const seed = (0xA110C0DE + g * 0x9E3779B9) >>> 0;
    const game = new Game(null, { aiPlayers: ['player', 'opponent'], seed });
    game.rng = new RNG(seed);
    await game.setupMatch();
    if (!cardIndex && game?._cardIndex instanceof Map) cardIndex = game._cardIndex;
    const ai = new BasicAI({ resourceSystem: game.resources, combatSystem: game.combat });
    let completedRounds = 0;
    while (
      completedRounds < rounds
      && game.player?.hero?.data?.health > 0
      && game.opponent?.hero?.data?.health > 0
    ) {
      collectSideSamples(game.player, 'player', samples, traitPresence);
      collectSideSamples(game.opponent, 'opponent', samples, traitPresence);

      ai.takeTurn(game.player, game.opponent);
      collectSideSamples(game.player, 'player', samples, traitPresence);
      collectSideSamples(game.opponent, 'opponent', samples, traitPresence);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      game.turns.setActivePlayer(game.opponent);
      game.turns.startTurn();
      game.resources.startTurn(game.opponent);
      ai.takeTurn(game.opponent, game.player);
      collectSideSamples(game.player, 'player', samples, traitPresence);
      collectSideSamples(game.opponent, 'opponent', samples, traitPresence);
      if (game.opponent.hero.data.health <= 0 || game.player.hero.data.health <= 0) break;

      while (game.turns.current !== 'End') game.turns.nextPhase();
      game.turns.nextPhase();
      game.turns.setActivePlayer(game.player);
      game.turns.startTurn();
      game.resources.startTurn(game.player);
      completedRounds += 1;
    }
  }

  const keywordColumns = FEATURE_COLUMNS.slice(2); // boolean traits start at index 2
  keywordColumns.forEach((keyword) => {
    const idx = FEATURE_COLUMNS.indexOf(keyword);
    if (idx < 0) return;
    if (!traitPresence[idx]) {
      samples.push({
        cardId: `synthetic-${keyword}`,
        owner: 'synthetic',
        heroId: null,
        vector: syntheticVectorFor(keyword)
      });
      traitPresence[idx] = true;
    }
  });

  return { samples, cardIndex };
}

async function main() {
  const cfg = parseCliArgs();
  if (cfg.help) {
    console.log('Usage: node tools/encode-minions.mjs [--games=N] [--rounds=N]');
    console.log('Samples AI vs AI skirmishes and writes data/datasets/minion-encodings.json.');
    return;
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const { samples } = await simulateAndCollect({ games: cfg.games, rounds: cfg.rounds });
  if (!samples.length) {
    throw new Error('[encode-minions] No samples collected; try increasing --games/--rounds.');
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    games: cfg.games,
    rounds: cfg.rounds,
    sampleCount: samples.length,
    columns: FEATURE_COLUMNS,
  };

  const payload = { metadata, samples };
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[encode-minions] Wrote ${samples.length} samples to ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

main().catch((err) => {
  console.error('[encode-minions] Failed:', err?.stack || err);
  process.exitCode = 1;
});
