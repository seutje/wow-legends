#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

const { log, error } = getOriginalConsole();

const ITERATIONS = 1500;
const ROLLOUT_DEPTH = 6;
const SEEDS = [0x1A2B3C00, 0x1A2B3C01, 0x1A2B3C02, 0x1A2B3C03];

function withDeterministicRng(seed, fn) {
  const rng = new RNG(seed);
  const prevRandom = Math.random;
  const prevNow = Date.now;
  let nowTick = 1_700_000_000_000;
  Math.random = rng.random.bind(rng);
  Date.now = () => (nowTick += 1);
  try {
    return fn();
  } finally {
    Math.random = prevRandom;
    Date.now = prevNow;
  }
}

function cloneEffects(effects = []) {
  return effects.map(effect => ({ ...effect }));
}

function makeCard(id, type, name, cost, {
  keywords = [],
  data = {},
  effects = [],
  combo = [],
  attack,
  durability,
} = {}) {
  const cardData = { ...data };
  if (type === 'ally') {
    if (typeof cardData.health === 'number' && cardData.maxHealth == null) {
      cardData.maxHealth = cardData.health;
    }
    if (cardData.attacked == null) cardData.attacked = false;
  }
  const card = {
    id,
    type,
    name,
    cost,
    keywords: [...keywords],
    data: cardData,
    effects: cloneEffects(effects),
    combo: cloneEffects(combo),
  };
  if (attack != null) card.attack = attack;
  if (durability != null) card.durability = durability;
  return card;
}

function buildScenario() {
  const game = new Game();
  const aiPlayer = game.opponent;
  const foe = game.player;

  game.turns.setActivePlayer(aiPlayer);
  game.turns.turn = 6;

  aiPlayer.cardsPlayedThisTurn = 1;
  aiPlayer.hero.data.maxHealth = 30;
  aiPlayer.hero.data.health = 18;
  aiPlayer.hero.data.attack = 1;
  aiPlayer.hero.data.attacked = false;
  aiPlayer.hero.active = [
    { type: 'damage', amount: 2, target: 'any' },
    { type: 'restore', amount: 1 },
  ];
  aiPlayer.hero.powerUsed = false;
  aiPlayer.hero.equipment = [
    makeCard('eq-stormhammer', 'equipment', 'Stormhammer', 3, { attack: 2 }),
  ];

  foe.cardsPlayedThisTurn = 0;
  foe.hero.data.maxHealth = 30;
  foe.hero.data.health = 16;
  foe.hero.data.attack = 0;
  foe.hero.data.attacked = false;
  foe.hero.powerUsed = false;
  foe.hero.active = [
    { type: 'damage', amount: 1, target: 'any' },
  ];

  game.resources.startTurn(aiPlayer);
  game.resources.startTurn(foe);
  const pool = game.resources.pool(aiPlayer);
  game.resources.addOverloadNextTurn(foe, 1);

  aiPlayer.hand.cards = [];
  aiPlayer.battlefield.cards = [];
  aiPlayer.graveyard.cards = [];
  foe.hand.cards = [];
  foe.battlefield.cards = [];
  foe.graveyard.cards = [];

  const sentinel = makeCard('bf-guardian', 'ally', 'Stoneclaw Guardian', 3, {
    keywords: ['Taunt'],
    data: { attack: 2, health: 5 },
  });
  const raider = makeCard('bf-raider', 'ally', 'Skybreaker Raider', 4, {
    keywords: ['Rush'],
    data: { attack: 3, health: 3, enteredTurn: game.turns.turn },
    effects: [{ type: 'damage', amount: 1 }],
  });
  aiPlayer.battlefield.cards.push(sentinel, raider);

  const foeTaunt = makeCard('foe-taunt', 'ally', 'Shielded Bruiser', 4, {
    keywords: ['Taunt'],
    data: { attack: 3, health: 6 },
  });
  const foeStalker = makeCard('foe-stalker', 'ally', 'Silent Stalker', 3, {
    keywords: ['Stealth'],
    data: { attack: 4, health: 2 },
  });
  foe.battlefield.cards.push(foeTaunt, foeStalker);

  const handCards = [
    makeCard('hand-lava', 'spell', 'Lava Burst', 3, {
      effects: [{ type: 'damage', amount: 5 }],
    }),
    makeCard('hand-link', 'spell', 'Spirit Link', 2, {
      effects: [
        { type: 'heal', amount: 4 },
        { type: 'restore', amount: 1 },
      ],
    }),
    makeCard('hand-destroyer', 'ally', 'Fireguard Destroyer', 4, {
      keywords: ['Taunt'],
      data: { attack: 4, health: 6 },
      effects: [{ type: 'overload', amount: 1 }],
    }),
    makeCard('hand-spirits', 'spell', 'Feral Spirit', 3, {
      effects: [
        { type: 'summon', count: 2, unit: { name: 'Spirit Wolf', attack: 2, health: 3, keywords: ['Taunt'] } },
        { type: 'overload', amount: 2 },
      ],
    }),
    makeCard('hand-bolt', 'spell', 'Lightning Bolt', 1, {
      effects: [{ type: 'damage', amount: 3 }],
    }),
    makeCard('hand-surge', 'spell', 'Totemic Surge', 0, {
      effects: [{ type: 'restore', amount: 2 }],
    }),
  ];
  aiPlayer.hand.cards.push(...handCards);

  const foeHand = [
    makeCard('foe-flames', 'spell', 'Flamestrike', 7, {
      effects: [{ type: 'damage', amount: 4 }],
    }),
    makeCard('foe-heal', 'spell', 'Greater Heal', 3, {
      effects: [{ type: 'heal', amount: 6 }],
    }),
    makeCard('foe-raise', 'spell', 'Raise Dead', 4, {
      effects: [{ type: 'summon', count: 1, unit: { name: 'Ghoul', attack: 4, health: 4 } }],
    }),
  ];
  foe.hand.cards.push(...foeHand);

  const enteredThisTurn = new Set([raider.id]);

  const rootState = {
    player: aiPlayer,
    opponent: foe,
    pool,
    turn: game.turns.turn,
    powerAvailable: true,
    overloadNextPlayer: 0,
    overloadNextOpponent: 1,
    enteredThisTurn,
  };

  return { game, rootState };
}

function describeAction(action) {
  if (!action) return 'no action';
  if (action.end) return 'end turn';
  const parts = [];
  if (action.card) parts.push(`play ${action.card.name}`);
  if (action.usePower) parts.push('use hero power');
  return parts.length ? parts.join(' + ') : 'no action';
}

function summarize(times) {
  const sorted = [...times].sort((x, y) => x - y);
  const total = times.reduce((acc, t) => acc + t, 0);
  const mean = total / times.length;
  const median = sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const variance = times.reduce((acc, t) => acc + ((t - mean) ** 2), 0) / times.length;
  const stddev = Math.sqrt(variance);
  return {
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stddev,
  };
}

function formatMs(value) {
  return `${value.toFixed(3)} ms`;
}

function formatStats(label, stats, runs) {
  return [
    `${label}:`,
    `  runs: ${runs}`,
    `  mean: ${formatMs(stats.mean)}`,
    `  median: ${formatMs(stats.median)}`,
    `  min: ${formatMs(stats.min)}`,
    `  max: ${formatMs(stats.max)}`,
    `  stddev: ${formatMs(stats.stddev)}`,
  ].join('\n');
}

function runIteration(ai, seed) {
  return withDeterministicRng(seed, () => {
    const { game, rootState } = buildScenario();
    ai.resources = game.resources;
    ai.combat = game.combat;
    ai.game = game;
    const start = performance.now();
    const action = ai._search(rootState);
    const elapsed = performance.now() - start;
    return { elapsed, action };
  });
}

function runBenchmark() {
  const ai = new MCTS_AI({ iterations: ITERATIONS, rolloutDepth: ROLLOUT_DEPTH });
  const times = [];
  const actions = [];

  for (const seed of SEEDS) {
    const { elapsed, action } = runIteration(ai, seed);
    times.push(elapsed);
    actions.push(action);
  }

  return {
    stats: summarize(times),
    actions,
    times,
  };
}

function formatActions(label, actions) {
  const lines = actions.map((action, idx) => `  run ${idx + 1}: ${describeAction(action)}`);
  return [
    `${label} actions:`,
    ...lines,
  ].join('\n');
}

function main() {
  log(`[bench] Config iterations=${ITERATIONS} rolloutDepth=${ROLLOUT_DEPTH} runs=${SEEDS.length}`);
  const cpu = runBenchmark();
  log(formatActions('[bench] CPU', cpu.actions));
  log(formatStats('[bench] CPU stats', cpu.stats, SEEDS.length));
}

try {
  main();
} catch (err) {
  error(`[bench] ${err.message}`);
  process.exit(1);
}
