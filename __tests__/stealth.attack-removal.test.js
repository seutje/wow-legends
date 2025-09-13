import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import { selectTargets } from '../src/js/systems/targeting.js';

test('stealthed ally loses stealth after attacking and becomes targetable', async () => {
  const g = new Game();
  g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
  g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });

  const sneaky = new Card({ name: 'Sneaky', type: 'ally', data: { attack: 2, health: 2 }, keywords: ['Stealth'] });
  g.player.battlefield.cards = [sneaky];

  // Initially cannot be targeted due to Stealth
  expect(selectTargets([sneaky])).toEqual([]);

  // Attack enemy hero (no blockers)
  const ok = await g.attack(g.player, sneaky.id);
  expect(ok).toBe(true);

  // After attacking, Stealth is removed and it becomes targetable
  expect(sneaky.keywords).not.toContain('Stealth');
  expect(selectTargets([sneaky])).toEqual([sneaky]);
});

