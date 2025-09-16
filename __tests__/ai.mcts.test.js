import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

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

test('MCTS can chain multiple plays in a turn', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 250, rolloutDepth: 4 });
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

  await ai.takeTurn(g.opponent, g.player);

  expect(g.opponent.graveyard.cards).toHaveLength(0);
  expect(g.opponent.hand.cards.map(c => c.name)).toEqual(expect.arrayContaining([
    'Shield Slam',
    'Healing Potion',
    'Mana Potion'
  ]));
  expect(g.opponent.hero.powerUsed).toBe(false);
});
