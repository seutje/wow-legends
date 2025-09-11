import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

test('AI attacks taunt ally instead of hero', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });

  const defender = new Card({ name: 'Orgrimmar Grunt', type: 'ally', data: { attack: 2, health: 2 }, keywords: ['Taunt'] });
  const attacker = new Card({ name: 'Attacker', type: 'ally', data: { attack: 3, health: 3 } });

  g.player.battlefield.cards = [defender];
  g.opponent.battlefield.cards = [attacker];

  await g.endTurn();

  expect(g.player.hero.data.health).toBe(10);
  expect(g.player.graveyard.cards).toContain(defender);
});
