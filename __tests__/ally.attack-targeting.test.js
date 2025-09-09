import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

// Equipment should not be selectable as a target when attacking with an ally.
test('equipment cannot be targeted by ally attacks', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });

  const ally = new Card({ name: 'Attacker', type: 'ally', data: { attack: 2, health: 2 } });
  const equipment = new Card({ name: 'Sword', type: 'equipment', data: {} });

  g.player.battlefield.cards = [ally];
  g.opponent.battlefield.cards = [equipment];
  g.opponent.hero.equipment.push(equipment);

  const initial = g.opponent.hero.data.health;
  await g.attack(g.player, ally.id, equipment.id);

  expect(g.opponent.hero.data.health).toBe(initial - 2);
  expect(g.opponent.battlefield.cards).toContain(equipment);
});

// Quests should not be selectable as attack targets.
test('quest cannot be targeted by ally attacks', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });

  const ally = new Card({ name: 'Attacker', type: 'ally', data: { attack: 2, health: 2 } });
  const quest = new Card({ name: 'Quest', type: 'quest', data: {} });

  g.player.battlefield.cards = [ally];
  g.opponent.battlefield.cards = [quest];

  const initial = g.opponent.hero.data.health;
  await g.attack(g.player, ally.id, quest.id);

  expect(g.opponent.hero.data.health).toBe(initial - 2);
  expect(g.opponent.battlefield.cards).toContain(quest);
});
