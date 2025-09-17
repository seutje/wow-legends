import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import Hero from '../src/js/entities/hero.js';

test('AI Sap returns player ally to player hand and increases cost', async () => {
  const g = new Game();
  await g.setupMatch();

  // Controlled setup
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.opponent, 10);

  // Player has an ally on board
  const playerAlly = new Card({ name: 'Target Ally', type: 'ally', cost: 2, data: { attack: 2, health: 2 }, keywords: [] });
  g.player.battlefield.add(playerAlly);

  // Give AI Sap and play it
  const sapData = g.allCards.find(c => c.id === 'spell-sap');
  const sap = new Card(sapData);
  g.opponent.hand.add(sap);

  await g.playFromHand(g.opponent, sap.id);

  expect(g.player.battlefield.cards.length).toBe(0);
  expect(g.player.hand.cards.some(c => c.name === 'Target Ally')).toBe(true);
  const returned = g.player.hand.cards.find(c => c.name === 'Target Ally');
  expect(returned.cost).toBe(3); // cost increased by 1
});

test('AI Shadow Word: Pain destroys player ally (<=3 ATK)', async () => {
  const g = new Game();
  await g.setupMatch();

  // Controlled setup
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.opponent, 10);

  // Player has a low-attack ally on board
  const playerAlly = new Card({ name: 'Weak Ally', type: 'ally', data: { attack: 2, health: 2 }, keywords: [] });
  g.player.battlefield.add(playerAlly);

  // Give AI Shadow Word: Pain and play it
  const swpData = g.allCards.find(c => c.id === 'spell-shadow-word-pain');
  const swp = new Card(swpData);
  g.opponent.hand.add(swp);

  await g.playFromHand(g.opponent, swp.id);

  expect(g.player.battlefield.cards.length).toBe(0);
  expect(g.player.graveyard.cards.some(c => c.name === 'Weak Ally')).toBe(true);
});

test('Player Shadow Word: Pain prompts for a target when multiple enemies are valid', async () => {
  const g = new Game();
  await g.setupMatch();

  // Controlled setup
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const enemyOne = new Card({ name: 'Enemy One', type: 'ally', data: { attack: 2, health: 2 }, keywords: [] });
  const enemyTwo = new Card({ name: 'Enemy Two', type: 'ally', data: { attack: 3, health: 3 }, keywords: [] });
  g.opponent.battlefield.add(enemyOne);
  g.opponent.battlefield.add(enemyTwo);

  const swpData = g.allCards.find(c => c.id === 'spell-shadow-word-pain');
  const swp = new Card(swpData);
  g.player.hand.add(swp);

  const promptSpy = jest.fn(async (candidates) => candidates[1]);
  g.promptTarget = promptSpy;

  await g.playFromHand(g.player, swp.id);

  expect(promptSpy).toHaveBeenCalledTimes(1);
  const [candidates] = promptSpy.mock.calls[0];
  expect(candidates).toHaveLength(2);
  expect(g.opponent.battlefield.cards).toContain(enemyOne);
  expect(g.opponent.battlefield.cards).not.toContain(enemyTwo);
  expect(g.opponent.graveyard.cards).toContain(enemyTwo);
});

test('AI Consecration damages only player side (all enemies)', async () => {
  const g = new Game();
  await g.setupMatch();

  // Controlled setup
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.hero.data.armor = 0;
  g.opponent.hero.data.armor = 0;
  g.resources._pool.set(g.opponent, 10);

  // Player side units
  const p1 = new Card({ name: 'P1', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  const p2 = new Card({ name: 'P2', type: 'ally', data: { attack: 0, health: 4 }, keywords: [] });
  g.player.battlefield.add(p1);
  g.player.battlefield.add(p2);

  // Opponent side units
  const e1 = new Card({ name: 'E1', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  g.opponent.battlefield.add(e1);

  // Give AI Consecration and play it
  const consecData = g.allCards.find(c => c.id === 'spell-consecration');
  const consec = new Card(consecData);
  g.opponent.hand.add(consec);

  const playerHeroBefore = g.player.hero.data.health;
  const oppHeroBefore = g.opponent.hero.data.health;
  const p1Before = p1.data.health;
  const p2Before = p2.data.health;
  const e1Before = e1.data.health;

  await g.playFromHand(g.opponent, consec.id);

  // Player side takes damage
  expect(g.player.hero.data.health).toBe(playerHeroBefore - 2);
  expect(p1.data.health).toBe(p1Before - 2);
  expect(p2.data.health).toBe(p2Before - 2);

  // Opponent side remains undamaged
  expect(g.opponent.hero.data.health).toBe(oppHeroBefore);
  expect(e1.data.health).toBe(e1Before);
});

test('AI Rexxar hero power targets player hero or a minion without Taunt', async () => {
  const g = new Game();
  await g.setupMatch();

  // Set AI hero to Rexxar and give mana
  const rexxar = g.allCards.find(c => c.id === 'hero-rexxar-beastmaster');
  g.opponent.hero = new Hero(rexxar);
  g.turns.turn = 2;
  g.resources.startTurn(g.opponent);
  g.turns.setActivePlayer(g.opponent);

  // Player board: one Taunt and one non-Taunt to validate filtering
  const taunt = new Card({ name: 'Taunter', type: 'ally', data: { attack: 1, health: 3 }, keywords: ['Taunt'] });
  const vanilla = new Card({ name: 'NoTaunt', type: 'ally', data: { attack: 1, health: 3 }, keywords: [] });
  g.player.battlefield.add(taunt);
  g.player.battlefield.add(vanilla);

  // Deterministic AI target: first candidate (player hero)
  g.rng.pick = (arr) => arr[0];
  g.player.hero.data.armor = 0;
  const beforeHero = g.player.hero.data.health;

  await g.useHeroPower(g.opponent);

  expect(g.player.hero.data.health).toBe(beforeHero - 2);
  // Ensure Taunt didn't invalidate the hero target and nothing else was damaged
  expect(vanilla.data.health).toBe(3);
  expect(taunt.data.health).toBe(3);
});

test('AI Savage Roar buffs only its own allies and hero', async () => {
  const g = new Game();
  await g.setupMatch();

  // Clear and set board state
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  const pAlly = new Card({ name: 'Player Ally', type: 'ally', data: { attack: 1, health: 3 }, keywords: [] });
  const eAlly1 = new Card({ name: 'Enemy Ally 1', type: 'ally', data: { attack: 1, health: 3 }, keywords: [] });
  const eAlly2 = new Card({ name: 'Enemy Ally 2', type: 'ally', data: { attack: 2, health: 2 }, keywords: [] });
  g.player.battlefield.add(pAlly);
  g.opponent.battlefield.add(eAlly1);
  g.opponent.battlefield.add(eAlly2);
  g.resources._pool.set(g.opponent, 10);

  // Give AI Savage Roar and play it
  const roarData = g.allCards.find(c => c.id === 'spell-savage-roar');
  const roar = new Card(roarData);
  g.opponent.hand.add(roar);

  const oppHeroAttackBefore = g.opponent.hero.data.attack || 0;
  const e1AtkBefore = eAlly1.data.attack;
  const e2AtkBefore = eAlly2.data.attack;
  const pAtkBefore = pAlly.data.attack;

  await g.playFromHand(g.opponent, roar.id);

  expect(g.opponent.hero.data.attack).toBe(oppHeroAttackBefore + 2);
  expect(eAlly1.data.attack).toBe(e1AtkBefore + 2);
  expect(eAlly2.data.attack).toBe(e2AtkBefore + 2);
  // Player ally unchanged
  expect(pAlly.data.attack).toBe(pAtkBefore);
});

test('AI Thrall hero power (upToThreeTargets) prefers player side', async () => {
  const g = new Game();
  await g.setupMatch();

  // Set AI hero to Thrall and give mana
  const thrall = g.allCards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');
  g.opponent.hero = new Hero(thrall);
  g.turns.turn = 10;
  g.turns.setActivePlayer(g.opponent);
  g.resources.startTurn(g.opponent);

  // Player side: hero + two allies (3 targets)
  const p1 = new Card({ name: 'P1', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  const p2 = new Card({ name: 'P2', type: 'ally', data: { attack: 0, health: 4 }, keywords: [] });
  g.player.battlefield.add(p1);
  g.player.battlefield.add(p2);

  // Opponent side also has an ally to ensure not chosen
  const e1 = new Card({ name: 'E1', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  g.opponent.battlefield.add(e1);

  // Deterministic target order for AI
  g.rng.pick = (arr) => arr[0];

  // Remove armor to observe health damage clearly
  g.player.hero.data.armor = 0;

  const heroBefore = g.player.hero.data.health;
  const p1Before = p1.data.health;
  const p2Before = p2.data.health;
  const e1Before = e1.data.health;

  await g.useHeroPower(g.opponent);

  // Three different player targets took 1 damage
  expect(g.player.hero.data.health).toBe(heroBefore - 1);
  expect(p1.data.health).toBe(p1Before - 1);
  expect(p2.data.health).toBe(p2Before - 1);
  // AI side unaffected
  expect(e1.data.health).toBe(e1Before);
});

test('AI Jaina hero power (character) targets player hero', async () => {
  const g = new Game();
  await g.setupMatch();

  // Set AI hero to Jaina and give mana
  const jaina = g.allCards.find(c => c.id === 'hero-jaina-proudmoore-archmage');
  g.opponent.hero = new Hero(jaina);
  g.turns.turn = 2;
  g.turns.setActivePlayer(g.opponent);
  g.resources.startTurn(g.opponent);

  // Player has an ally too; AI should still prefer enemy hero first
  const p1 = new Card({ name: 'P1', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  g.player.battlefield.add(p1);

  // Deterministic target choice
  g.rng.pick = (arr) => arr[0];

  // Remove armor to observe health damage clearly
  g.player.hero.data.armor = 0;

  const heroBefore = g.player.hero.data.health;

  await g.useHeroPower(g.opponent);

  expect(g.player.hero.data.health).toBe(heroBefore - 1);
  expect(g.player.hero.data.freezeTurns || 0).toBeGreaterThan(0);
});
