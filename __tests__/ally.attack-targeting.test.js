import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import { getCardInstanceId } from '../src/js/utils/card.js';

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

// Taunt allies must be attacked before the enemy hero.
test('taunt forces attacks to target taunt ally', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });

  const attacker = new Card({ name: 'Attacker', type: 'ally', data: { attack: 2, health: 2 } });
  const taunt = new Card({ name: 'Orgrimmar Grunt', type: 'ally', data: { attack: 2, health: 2 }, keywords: ['Taunt'] });

  g.player.battlefield.cards = [attacker];
  g.opponent.battlefield.cards = [taunt];

  const initial = g.opponent.hero.data.health;
  await g.attack(g.player, attacker.id, g.opponent.hero.id);

  expect(g.opponent.hero.data.health).toBe(initial);
  expect(g.opponent.graveyard.cards).toContain(taunt);
});

test('identical allies attack independently using instance ids', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 20 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 20 } });

  const makeShieldbearer = () => new Card({
    id: 'ally-shoal-shieldbearer',
    name: 'Shoal Shieldbearer',
    type: 'ally',
    data: { attack: 2, health: 4 },
    keywords: ['Murloc'],
  });

  const first = makeShieldbearer();
  const second = makeShieldbearer();

  g.player.battlefield.cards = [first, second];

  g.turns.setActivePlayer(g.player);
  g.turns.startTurn();

  const firstId = getCardInstanceId(first);
  const secondId = getCardInstanceId(second);

  const initialHealth = g.opponent.hero.data.health;
  const okFirst = await g.attack(g.player, firstId);
  expect(okFirst).toBe(true);
  expect(first.data.attacked).toBe(true);
  expect(second.data.attacked).not.toBe(true);
  expect(g.opponent.hero.data.health).toBe(initialHealth - 2);

  const healthAfterFirst = g.opponent.hero.data.health;
  const okSecond = await g.attack(g.player, secondId);
  expect(okSecond).toBe(true);
  expect(second.data.attacked).toBe(true);
  expect(g.opponent.hero.data.health).toBe(healthAfterFirst - 2);
});
