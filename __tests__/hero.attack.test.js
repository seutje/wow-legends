import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

test('hero attacks instantly and only once per turn', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { attack: 2, health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];

  expect(await g.attack(g.player, g.player.hero.id)).toBe(true);
  expect(g.opponent.hero.data.health).toBe(8);
  expect(await g.attack(g.player, g.player.hero.id)).toBe(false);
  expect(g.opponent.hero.data.health).toBe(8);
});

test('hero can target enemy allies', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { attack: 3, health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
  const foe = new Card({ name: 'Foe', data: { attack: 1, health: 3 } });
  g.opponent.battlefield.cards = [foe];
  g.player.battlefield.cards = [];

  await g.attack(g.player, g.player.hero.id, foe.id);
  expect(foe.data.health).toBe(0);
  expect(g.opponent.hero.data.health).toBe(10);
});

