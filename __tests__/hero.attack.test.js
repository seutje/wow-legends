import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

test('hero can attack when toggled', () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { attack: 2, health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];

  expect(g.toggleAttacker(g.player, g.player.hero.id)).toBe(true);
  g.resolveCombat(g.player, g.opponent);
  expect(g.opponent.hero.data.health).toBe(8);
});
