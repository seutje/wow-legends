import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

test('Charge ally can attack face on the turn it is played', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 30 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const charge = new Card({ name: 'Charger', type: 'ally', cost: 1, data: { attack: 3, health: 2 }, keywords: ['Charge'] });
  g.player.hand.add(charge);
  await g.playFromHand(g.player, charge.id);

  const before = g.opponent.hero.data.health;
  const ok = await g.attack(g.player, charge.id);
  expect(ok).toBe(true);
  expect(g.opponent.hero.data.health).toBe(before - 3);
});

test('Rush ally cannot attack face on the turn it is played (no enemies)', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 30 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const rush = new Card({ name: 'Runner', type: 'ally', cost: 1, data: { attack: 2, health: 2 }, keywords: ['Rush'] });
  g.player.hand.add(rush);
  await g.playFromHand(g.player, rush.id);

  const before = g.opponent.hero.data.health;
  const ok = await g.attack(g.player, rush.id);
  expect(ok).toBe(false);
  expect(g.opponent.hero.data.health).toBe(before);
});

test('Rush ally can attack enemy allies on the turn it is played', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 30 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const rush = new Card({ name: 'Runner', type: 'ally', cost: 1, data: { attack: 2, health: 2 }, keywords: ['Rush'] });
  g.player.hand.add(rush);
  await g.playFromHand(g.player, rush.id);

  const enemy = new Card({ name: 'Enemy Ally', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  g.opponent.battlefield.add(enemy);

  const ok = await g.attack(g.player, rush.id);
  expect(ok).toBe(true);
  expect(enemy.data.health).toBe(1);
  expect(g.opponent.hero.data.health).toBe(10);
});

