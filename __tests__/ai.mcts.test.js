import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { getCardInstanceId } from '../src/js/utils/card.js';

test('MCTS prefers lethal damage over healing', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 200, rolloutDepth: 3 });
  g.turns.turn = 5;

  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 20;
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 2;

  const dmg = new Card({ type: 'spell', name: 'Zap', cost: 1, effects: [{ type: 'damage', target: 'any', amount: 2 }] });
  const heal = new Card({ type: 'consumable', name: 'Bandage', cost: 1, effects: [{ type: 'heal', target: 'character', amount: 5 }] });
  g.opponent.hand.add(dmg);
  g.opponent.hand.add(heal);

  g.turns.setActivePlayer(g.opponent);
  // ensure enough resources
  g.resources._pool.set(g.opponent, 5);

  return ai.takeTurn(g.opponent, g.player).then(() => {
    // Player (enemy) should be at 0 (lethal from Zap)
    expect(g.player.hero.data.health).toBe(0);
    // Zap should be in graveyard; heal likely remains in hand (not required)
    expect(g.opponent.graveyard.cards.find(c => c.name === 'Zap')).toBeTruthy();
  });
});

test('MCTS stops tree search once lethal discovered', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 200, rolloutDepth: 2 });

  g.turns.turn = 6;
  g.turns.setActivePlayer(g.opponent);
  g.opponent.hand.cards = [];
  g.opponent.hero.active = [];
  g.opponent.hero.powerUsed = true;
  g.resources._pool.set(g.opponent, 0);

  const attacker = new Card({
    id: 'lethal-attacker',
    type: 'ally',
    name: 'Aggressive Raider',
    data: { attack: 4, health: 3, maxHealth: 3, enteredTurn: 0 }
  });
  g.opponent.battlefield.cards = [attacker];
  g.player.hero.data.health = 4;

  const state = ai._stateFromLive(g.opponent, g.player);
  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    const action = ai._search(state);
    expect(action.attack).toBeTruthy();

    const root = ai._lastTree?.node;
    expect(root).toBeTruthy();
    expect(root.visits).toBeLessThan(ai.iterations);
    const lethalChild = root.children.find(ch => ch.action?.attack);
    expect(lethalChild?.hasLethal).toBe(true);
  } finally {
    Math.random = origRandom;
  }
});

test('MCTS spends resources to deploy large vanilla allies', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 200, rolloutDepth: 3 });

  g.turns.turn = 10;
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hero.active = [];
  g.opponent.hero.powerUsed = false;
  g.resources._pool.set(g.opponent, 10);
  g.turns.setActivePlayer(g.opponent);

  const colossus = new Card({
    id: 'test-colossus',
    type: 'ally',
    name: 'Arcane Colossus',
    cost: 8,
    data: { attack: 8, health: 8, maxHealth: 8 },
  });
  g.opponent.hand.add(colossus);

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    await ai.takeTurn(g.opponent, g.player);
  } finally {
    Math.random = origRandom;
  }

  expect(g.opponent.battlefield.cards.some(c => c.name === 'Arcane Colossus')).toBe(true);
  expect(g.opponent.hand.cards.some(c => c.name === 'Arcane Colossus')).toBe(false);
});

test('MCTS simulation targets the biggest threat with single-target removal', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 100, rolloutDepth: 3 });

  g.turns.turn = 6;
  g.turns.setActivePlayer(g.opponent);
  g.opponent.hero.active = [];

  const bigThreat = new Card({
    id: 'big-threat',
    type: 'ally',
    name: 'Huge Golem',
    data: { attack: 8, health: 6, maxHealth: 6, enteredTurn: 0 }
  });
  const smallThreat = new Card({
    id: 'small-threat',
    type: 'ally',
    name: 'Tiny Imp',
    data: { attack: 1, health: 2, maxHealth: 2, enteredTurn: 0 }
  });
  g.player.battlefield.cards = [bigThreat, smallThreat];

  const removal = new Card({
    id: 'removal',
    type: 'spell',
    name: 'Execute',
    cost: 4,
    effects: [
      { type: 'damage', target: 'minion', amount: 6 }
    ]
  });
  g.opponent.hand.cards = [removal];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.opponent, 6);

  const state = ai._stateFromLive(g.opponent, g.player);
  const actions = ai._legalActions(state);
  const removalAction = actions.find((act) => act.card && act.card.id === 'removal');
  expect(removalAction).toBeTruthy();

  const result = ai._applyAction(state, removalAction);
  expect(result.terminal).toBe(false);
  expect(removalAction.__mctsTargetSignature).toContain('big-threat');
  expect(ai._actionSignature(removalAction)).toContain('big-threat');

  const enemyBattlefield = result.state.opponent.battlefield.cards.map((c) => c.id);
  expect(enemyBattlefield).not.toContain('big-threat');
  expect(enemyBattlefield).toContain('small-threat');
  expect(result.state.opponent.graveyard.cards.some((c) => c.id === 'big-threat')).toBe(true);
});

test('MCTS can chain multiple plays in a turn', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 1000, rolloutDepth: 4 });
  g.turns.turn = 4;
  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 30;
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 10;

  const zap1 = new Card({ type: 'spell', name: 'Zap A', cost: 1, effects: [{ type: 'damage', target: 'any', amount: 2 }] });
  const zap2 = new Card({ type: 'spell', name: 'Zap B', cost: 1, effects: [{ type: 'damage', target: 'any', amount: 2 }] });
  g.opponent.hand.add(zap1);
  g.opponent.hand.add(zap2);
  g.resources._pool.set(g.opponent, 2);
  g.turns.setActivePlayer(g.opponent);

  return ai.takeTurn(g.opponent, g.player).then(() => {
    // Expect both spells cast and 4 damage dealt in total (attacks may add more but at least 4)
    expect(g.opponent.graveyard.cards.find(c => c.name === 'Zap A')).toBeTruthy();
    expect(g.opponent.graveyard.cards.find(c => c.name === 'Zap B')).toBeTruthy();
    expect(g.player.hero.data.health).toBeLessThanOrEqual(6);
  });
});

test('MCTS executes lethal sequences using multiple attacks', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 400, rolloutDepth: 3 });
  g.turns.turn = 6;
  g.turns.setActivePlayer(g.opponent);

  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 6;
  g.player.hero.data.armor = 0;

  const raiderA = new Card({ id: 'raider-a', type: 'ally', name: 'Raider A', data: { attack: 3, health: 3, enteredTurn: 1 } });
  const raiderB = new Card({ id: 'raider-b', type: 'ally', name: 'Raider B', data: { attack: 3, health: 3, enteredTurn: 1 } });
  raiderA.data.attacked = false;
  raiderA.data.attacksUsed = 0;
  raiderB.data.attacked = false;
  raiderB.data.attacksUsed = 0;
  g.opponent.battlefield.cards = [raiderA, raiderB];
  g.opponent.hand.cards = [];
  g.resources._pool.set(g.opponent, 0);

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    await ai.takeTurn(g.opponent, g.player, { resume: true });
  } finally {
    Math.random = origRandom;
  }

  expect(g.player.hero.data.health).toBeLessThanOrEqual(0);
  expect(g.opponent.battlefield.cards.every(c => c.data?.attacked)).toBe(true);
});

test('MCTS clears taunts before delivering lethal with attacks', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 500, rolloutDepth: 3 });
  g.turns.turn = 7;
  g.turns.setActivePlayer(g.opponent);

  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 3;
  g.player.hero.data.armor = 0;

  const tauntA = new Card({ id: 'taunt-a', type: 'ally', name: 'Wall A', keywords: ['Taunt'], data: { attack: 0, health: 2, enteredTurn: 0 } });
  const tauntB = new Card({ id: 'taunt-b', type: 'ally', name: 'Wall B', keywords: ['Taunt'], data: { attack: 0, health: 2, enteredTurn: 0 } });
  g.player.battlefield.cards = [tauntA, tauntB];

  const strikerA = new Card({ id: 'striker-a', type: 'ally', name: 'Striker A', data: { attack: 2, health: 2, enteredTurn: 1 } });
  const strikerB = new Card({ id: 'striker-b', type: 'ally', name: 'Striker B', data: { attack: 2, health: 2, enteredTurn: 1 } });
  const strikerC = new Card({ id: 'striker-c', type: 'ally', name: 'Striker C', data: { attack: 3, health: 2, enteredTurn: 1 } });
  for (const card of [strikerA, strikerB, strikerC]) {
    card.data.attacked = false;
    card.data.attacksUsed = 0;
  }
  g.opponent.battlefield.cards = [strikerA, strikerB, strikerC];
  g.opponent.hand.cards = [];
  g.resources._pool.set(g.opponent, 0);

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    await ai.takeTurn(g.opponent, g.player, { resume: true });
  } finally {
    Math.random = origRandom;
  }

  expect(g.player.hero.data.health).toBeLessThanOrEqual(0);
  expect(g.player.battlefield.cards.length).toBe(0);
  expect(g.player.graveyard.cards.some(c => c.id === 'taunt-a')).toBe(true);
  expect(g.player.graveyard.cards.some(c => c.id === 'taunt-b')).toBe(true);
});

test('MCTS skips cards with no meaningful effect', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 150, rolloutDepth: 3 });
  g.turns.turn = 5;

  g.opponent.hero.active = [];
  g.opponent.hero.effects = [];
  g.opponent.hero.powerUsed = false;
  g.opponent.hero.data.health = 30;
  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.armor = 0;
  g.opponent.hero.data.spellDamage = 0;
  g.opponent.battlefield.cards = [];
  g.opponent.library.cards = [];

  const shieldSlam = new Card({ type: 'spell', name: 'Shield Slam', cost: 1, effects: [{ type: 'damageArmor', target: 'minion' }] });
  const healingPotion = new Card({ type: 'consumable', name: 'Healing Potion', cost: 1, effects: [{ type: 'heal', target: 'character', amount: 5 }] });
  const manaPotion = new Card({
    type: 'consumable',
    name: 'Mana Potion',
    cost: 0,
    effects: [
      { type: 'restore', amount: 2, requiresSpent: 2 },
      { type: 'overload', amount: 1 }
    ]
  });

  g.opponent.hand.add(shieldSlam);
  g.opponent.hand.add(healingPotion);
  g.opponent.hand.add(manaPotion);
  g.turns.setActivePlayer(g.opponent);

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    await ai.takeTurn(g.opponent, g.player);
  } finally {
    Math.random = origRandom;
  }

  expect(g.opponent.graveyard.cards).toHaveLength(0);
  expect(g.opponent.hand.cards.map(c => c.name)).toEqual(expect.arrayContaining([
    'Shield Slam',
    'Healing Potion',
    'Mana Potion'
  ]));
  expect(g.opponent.hero.powerUsed).toBe(false);
});

test('MCTS search includes pending overload from previous actions', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 20, rolloutDepth: 2 });

  g.turns.turn = 3;
  g.turns.setActivePlayer(g.opponent);
  g.opponent.hand.cards = [];

  const overloadBolt = new Card({
    type: 'spell',
    name: 'Overload Bolt',
    cost: 1,
    effects: [
      { type: 'damage', amount: 1, target: 'any' },
      { type: 'overload', amount: 2 }
    ]
  });

  g.opponent.hand.add(overloadBolt);

  const calls = [];
  const actions = [
    { card: overloadBolt, usePower: false, end: false },
    { end: true }
  ];

  const searchMock = jest.spyOn(ai, '_searchAsync').mockImplementation(async (rootState) => {
    calls.push(rootState.overloadNextPlayer);
    return actions.shift() || { end: true };
  });

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    await ai.takeTurn(g.opponent, g.player);
  } finally {
    Math.random = origRandom;
  }

  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls[0]).toBe(0);
  expect(calls[1]).toBe(2);

  searchMock.mockRestore();
});

test('MCTS skips temporary hero spell-damage buffs when there is no follow-up', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat });

  g.turns.turn = 3;
  g.turns.setActivePlayer(g.opponent);
  g.opponent.hero.active = [];
  g.opponent.hand.cards = [];

  const elixir = new Card({
    id: 'test-elixir',
    type: 'consumable',
    name: 'Elixir of Firepower',
    cost: 1,
    effects: [
      { type: 'buff', target: 'hero', property: 'spellDamage', amount: 1, duration: 'thisTurn' }
    ]
  });
  g.opponent.hand.add(elixir);

  const rootState = {
    player: g.opponent,
    opponent: g.player,
    pool: 3,
    turn: 3,
    powerAvailable: false,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
    enteredThisTurn: new Set(),
  };

  const actions = ai._legalActions(rootState);
  expect(actions.some(a => a.card?.name === 'Elixir of Firepower')).toBe(false);

  const sim = ai._buildSimFrom(g, g.opponent, g.player);
  const simActions = ai._legalActionsSim(sim, sim.player);
  expect(simActions.some(a => a.card?.name === 'Elixir of Firepower')).toBe(false);
});

test('MCTS filters useless healing hero power and cards in heuristic and full simulations', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat });
  const aiFull = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, fullSim: true });

  g.turns.turn = 3;
  g.turns.setActivePlayer(g.opponent);
  g.resources._pool.set(g.opponent, 3);

  g.opponent.hero.powerUsed = false;
  g.opponent.hero.active = [
    { type: 'heal', target: 'hero', amount: 2 }
  ];
  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 30;

  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 30;

  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.battlefield.cards = [];

  const salve = new Card({
    id: 'test-salve',
    type: 'spell',
    name: 'Renewing Salve',
    cost: 1,
    effects: [
      { type: 'heal', target: 'hero', amount: 4 }
    ]
  });

  g.opponent.hand.add(salve);

  const rootState = {
    player: g.opponent,
    opponent: g.player,
    pool: 3,
    turn: 3,
    powerAvailable: true,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
    enteredThisTurn: new Set(),
  };

  const heuristicActions = ai._legalActions(rootState);
  expect(heuristicActions).toHaveLength(1);
  expect(heuristicActions[0]).toEqual({ card: null, usePower: false, end: true });

  const sim = aiFull._buildSimFrom(g, g.opponent, g.player);
  const simActions = aiFull._legalActionsSim(sim, sim.player);
  expect(simActions).toHaveLength(1);
  expect(simActions[0]).toEqual({ card: null, usePower: false, end: true });
});

test('MCTS spell-damage buffs boost subsequent spell damage in the simple simulation', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat });

  g.turns.turn = 4;
  g.turns.setActivePlayer(g.opponent);
  g.opponent.hero.active = [];
  g.opponent.hand.cards = [];
  g.player.hero.data.health = 30;

  const elixir = new Card({
    id: 'test-elixir-followup',
    type: 'consumable',
    name: 'Elixir of Firepower',
    cost: 1,
    effects: [
      { type: 'buff', target: 'hero', property: 'spellDamage', amount: 1, duration: 'thisTurn' }
    ]
  });
  const bolt = new Card({
    id: 'test-firebolt',
    type: 'spell',
    name: 'Firebolt',
    cost: 2,
    effects: [
      { type: 'damage', target: 'character', amount: 2 }
    ]
  });

  g.opponent.hand.add(elixir);
  g.opponent.hand.add(bolt);

  const rootState = {
    player: g.opponent,
    opponent: g.player,
    pool: 4,
    turn: 4,
    powerAvailable: false,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
    enteredThisTurn: new Set(),
  };

  const afterElixir = ai._applyAction(rootState, { card: elixir, usePower: false, end: false });
  expect(afterElixir.terminal).toBe(false);
  expect(afterElixir.state.tempSpellDamage).toBe(1);

  const afterBolt = ai._applyAction(afterElixir.state, { card: bolt, usePower: false, end: false });
  expect(afterBolt.terminal).toBe(false);
  expect(afterBolt.state.opponent.hero.data.health).toBe(27);
  const graveNames = afterBolt.state.player.graveyard.cards.map(c => c.name);
  expect(graveNames).toEqual(expect.arrayContaining(['Elixir of Firepower', 'Firebolt']));
});

test('simple simulation tracks enrage triggers and penalizes leaving them alive', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, iterations: 50, rolloutDepth: 2 });

  g.turns.turn = 4;
  g.turns.setActivePlayer(g.opponent);

  const whirlwind = new Card({
    id: 'test-whirlwind',
    type: 'spell',
    name: 'Whirlwind',
    cost: 2,
    effects: [{ type: 'damage', target: 'allCharacters', amount: 1 }]
  });
  const tauren = new Card({
    id: 'test-tauren',
    type: 'ally',
    name: 'Tauren Brave',
    cost: 3,
    effects: [{ type: 'buffOnSurviveDamage', attack: 2 }],
    keywords: ['Taunt', 'Enrage'],
    data: { attack: 3, health: 3 }
  });

  g.opponent.hand.add(whirlwind);
  g.player.battlefield.cards.push(tauren);

  const rootState = {
    player: g.opponent,
    opponent: g.player,
    pool: 3,
    turn: 4,
    powerAvailable: false,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
    enteredThisTurn: new Set(),
  };

  const afterWhirl = ai._applyAction(rootState, { card: whirlwind, usePower: false, end: false });
  expect(afterWhirl.terminal).toBe(false);
  const simState = afterWhirl.state;
  const enemyMinion = simState.opponent.battlefield.cards[0];
  expect(enemyMinion.data.health).toBe(2);
  expect(enemyMinion.data.attack).toBe(5);
  const enemyKey = getCardInstanceId(enemyMinion);
  expect(simState.enragedOpponentThisTurn.get(enemyKey)).toBe(1);

  const scoreAfterWhirl = ai._resolveCombatAndScore(simState).value;
  const baseline = ai._resolveCombatAndScore(ai._cloneState(rootState)).value;
  expect(scoreAfterWhirl).toBeLessThan(baseline);
});

test('MCTS avoids Whirlwind when it cannot kill an enemy enrage minion', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 300, rolloutDepth: 3 });

  g.turns.turn = 4;
  g.turns.setActivePlayer(g.opponent);
  g.opponent.hero.active = [];
  g.opponent.hero.powerUsed = false;
  g.opponent.hand.cards = [];
  g.opponent.library.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.battlefield.cards = [];
  g.player.hero.data.health = 30;
  g.opponent.hero.data.health = 30;
  g.resources._pool.set(g.opponent, 3);

  const whirlwind = new Card({
    id: 'live-whirlwind',
    type: 'spell',
    name: 'Whirlwind',
    cost: 2,
    effects: [{ type: 'damage', target: 'allCharacters', amount: 1 }]
  });
  const tauren = new Card({
    id: 'live-tauren',
    type: 'ally',
    name: 'Tauren Brave',
    cost: 3,
    effects: [{ type: 'buffOnSurviveDamage', attack: 2 }],
    keywords: ['Taunt', 'Enrage'],
    data: { attack: 3, health: 3 }
  });

  g.opponent.hand.add(whirlwind);
  g.player.battlefield.cards.push(tauren);

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    await ai.takeTurn(g.opponent, g.player);
  } finally {
    Math.random = origRandom;
  }

  const taurenPost = g.player.battlefield.cards.find((c) => c.id === tauren.id);
  expect(taurenPost.data.health).toBe(3);
  expect(taurenPost.data.attack).toBe(3);
  expect(g.opponent.graveyard.cards.map(c => c.name)).not.toContain('Whirlwind');
});

test('_scoreRolloutAction rewards direct damage during rollouts', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat });

  g.turns.turn = 4;
  g.turns.setActivePlayer(g.opponent);
  g.resources._pool.set(g.opponent, 4);
  g.opponent.hero.active = [];
  g.opponent.hand.cards = [];
  g.player.hero.data.health = 10;

  const blast = new Card({
    id: 'rollout-blast',
    type: 'spell',
    name: 'Arcane Blast',
    cost: 2,
    effects: [{ type: 'damage', target: 'character', amount: 3 }]
  });

  g.opponent.hand.add(blast);

  const rootState = {
    player: g.opponent,
    opponent: g.player,
    pool: 4,
    turn: 4,
    powerAvailable: false,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
    enteredThisTurn: new Set(),
  };

  const result = ai._scoreRolloutAction(rootState, { card: blast, usePower: false, end: false });

  expect(result.delta).toBeGreaterThan(0);
  expect(result.outcome.terminal).toBe(false);
  const enemyHeroHealth = result.outcome.state.opponent.hero.data.health;
  expect(enemyHeroHealth).toBe(7);
  const graveNames = result.outcome.state.player.graveyard.cards.map(c => c.name);
  expect(graveNames).toContain('Arcane Blast');
});

test('_randomPlayout favors higher-scoring actions when not exploring', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, rolloutDepth: 1 });

  g.turns.turn = 4;
  g.turns.setActivePlayer(g.opponent);
  g.resources._pool.set(g.opponent, 4);
  g.opponent.hero.active = [];
  g.opponent.hand.cards = [];
  g.player.hero.data.health = 12;

  const blast = new Card({
    id: 'rollout-play-blast',
    type: 'spell',
    name: 'Arcane Blast',
    cost: 2,
    effects: [{ type: 'damage', target: 'character', amount: 3 }]
  });
  const mend = new Card({
    id: 'rollout-play-mend',
    type: 'consumable',
    name: 'Mend',
    cost: 2,
    effects: [{ type: 'heal', target: 'character', amount: 4 }]
  });

  g.opponent.hand.add(blast);
  g.opponent.hand.add(mend);

  const rootState = {
    player: g.opponent,
    opponent: g.player,
    pool: 4,
    turn: 4,
    powerAvailable: false,
    overloadNextPlayer: 0,
    overloadNextOpponent: 0,
    enteredThisTurn: new Set(),
  };

  const origRandom = Math.random;
  const sequence = [0.5, 0];
  Math.random = () => (sequence.length ? sequence.shift() : 0.1);

  let resolvedState = null;
  const resolveSpy = jest.spyOn(ai, '_resolveCombatAndScore').mockImplementation((state) => {
    resolvedState = state;
    return { terminal: true, value: 0 };
  });

  try {
    ai._randomPlayout(rootState);
  } finally {
    Math.random = origRandom;
    resolveSpy.mockRestore();
  }

  expect(resolvedState).toBeTruthy();
  const graveNames = resolvedState.player.graveyard.cards.map(c => c.name);
  expect(graveNames).toContain('Arcane Blast');
  const remainingHand = resolvedState.player.hand.cards.map(c => c.name);
  expect(remainingHand).toContain('Mend');
});

test('_randomPlayoutSim mirrors weighted rollout preferences', async () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, rolloutDepth: 1 });

  g.turns.turn = 4;
  g.turns.setActivePlayer(g.opponent);
  g.resources._pool.set(g.opponent, 4);
  g.resources._pool.set(g.player, 0);
  g.opponent.hero.active = [];
  g.opponent.hero.powerUsed = false;
  g.opponent.hand.cards = [];
  g.player.hero.data.health = 12;

  const blast = new Card({
    id: 'rollout-sim-blast',
    type: 'spell',
    name: 'Arcane Blast',
    cost: 2,
    effects: [{ type: 'damage', target: 'character', amount: 3 }]
  });
  const mend = new Card({
    id: 'rollout-sim-mend',
    type: 'consumable',
    name: 'Mend',
    cost: 2,
    effects: [{ type: 'heal', target: 'character', amount: 4 }]
  });

  g.opponent.hand.add(blast);
  g.opponent.hand.add(mend);

  const sim = ai._buildSimFrom(g, g.opponent, g.player);

  const origRandom = Math.random;
  const sequence = [0.5, 0];
  Math.random = () => (sequence.length ? sequence.shift() : 0.1);

  let resolvedSim = null;
  const resolveSpy = jest.spyOn(ai, '_resolveCombatAndScoreSim').mockImplementation(async (state) => {
    resolvedSim = state;
    return { terminal: true, value: 0 };
  });

  try {
    await ai._randomPlayoutSim(sim);
  } finally {
    Math.random = origRandom;
    resolveSpy.mockRestore();
  }

  expect(resolvedSim).toBeTruthy();
  const graveNames = resolvedSim.player.graveyard.cards.map(c => c.name);
  expect(graveNames).toContain('Arcane Blast');
  const remainingHand = resolvedSim.player.hand.cards.map(c => c.name);
  expect(remainingHand).toContain('Mend');
});
