import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import BasicAI from '../src/js/systems/ai.js';

test('AI skips playing Healing Potion when at full health', () => {
  const g = new Game();
  const ai = new BasicAI({ resourceSystem: g.resources, combatSystem: g.combat });
  g.turns.turn = 10;
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 30;
  g.player.library.cards = [];
  const potion = new Card({ type: 'consumable', name: 'Healing Potion', cost: 1, effects: [{ type: 'heal', target: 'character', amount: 5 }] });
  g.player.hand.add(potion);
  g.turns.setActivePlayer(g.player);
  ai.takeTurn(g.player, g.opponent);
  expect(g.player.hand.cards).toContain(potion);
  expect(g.resources.pool(g.player)).toBe(g.resources.available(g.player));
});

test('AI skips Mana Potion when resources are full', () => {
  const g = new Game();
  const ai = new BasicAI({ resourceSystem: g.resources, combatSystem: g.combat });
  g.turns.turn = 10;
  g.player.library.cards = [];
  const manaPotion = new Card({ type: 'consumable', name: 'Mana Potion', cost: 0, effects: [{ type: 'restore', amount: 2, requiresSpent: 2 }, { type: 'overload', amount: 1 }] });
  g.player.hand.add(manaPotion);
  g.turns.setActivePlayer(g.player);
  ai.takeTurn(g.player, g.opponent);
  expect(g.player.hand.cards).toContain(manaPotion);
  expect(g.resources.pool(g.player)).toBe(g.resources.available(g.player));
});

test('AI skips healing hero power when at full health', () => {
  const g = new Game();
  const ai = new BasicAI({ resourceSystem: g.resources, combatSystem: g.combat });
  g.turns.turn = 10;
  g.player.hero.active = [{ type: 'heal', target: 'character', amount: 2 }];
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 30;
  g.player.library.cards = [];
  g.turns.setActivePlayer(g.player);
  ai.takeTurn(g.player, g.opponent);
  expect(g.player.hero.powerUsed).toBe(false);
  expect(g.resources.pool(g.player)).toBe(g.resources.available(g.player));
});

test('AI does not target itself with damage spells', async () => {
  const g = new Game();
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 30;
  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 30;
  const fireball = new Card({ type: 'spell', name: 'Fireball', cost: 4, effects: [{ type: 'damage', target: 'any', amount: 6 }] });
  g.opponent.hand.add(fireball);
  g.resources._pool.set(g.opponent, 10);
  g.turns.setActivePlayer(g.opponent);
  g.rng.pick = (arr) => arr[arr.length - 1];
  await g.playFromHand(g.opponent, fireball.id);
  expect(g.player.hero.data.health).toBe(24);
  expect(g.opponent.hero.data.health).toBe(30);
});
