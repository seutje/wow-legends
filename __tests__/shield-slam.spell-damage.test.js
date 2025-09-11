import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import fs from 'fs';

test('Shield Slam gains damage from spell damage bonuses', async () => {
  const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
  const shieldData = cards.find(c => c.id === 'spell-shield-slam');

  const g = new Game();
  await g.setupMatch();

  // Prepare Shield Slam in hand
  const shieldSlam = new Card(shieldData);
  g.player.hand.add(shieldSlam);

  // Hero with armor and spell damage
  g.player.hero.data.armor = 5;
  g.player.hero.data.spellDamage = 1;

  // Enemy minion to target
  const enemy = new Card({ name: 'Target', type: 'ally', data: { attack: 0, health: 10 }, keywords: [] });
  g.opponent.battlefield.add(enemy);
  g.promptTarget = async () => enemy;

  await g.playFromHand(g.player, shieldSlam.id);

  // 5 armor + 1 spell damage = 6 total damage
  expect(enemy.data.health).toBe(4);
});

test('Shield Slam deals spell damage even with no armor', async () => {
  const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
  const shieldData = cards.find(c => c.id === 'spell-shield-slam');

  const g = new Game();
  await g.setupMatch();

  const shieldSlam = new Card(shieldData);
  g.player.hand.add(shieldSlam);

  g.player.hero.data.armor = 0;
  g.player.hero.data.spellDamage = 1;

  const enemy = new Card({ name: 'Target', type: 'ally', data: { attack: 0, health: 10 }, keywords: [] });
  g.opponent.battlefield.add(enemy);
  g.promptTarget = async () => enemy;

  await g.playFromHand(g.player, shieldSlam.id);

  // 0 armor + 1 spell damage = 1 total damage
  expect(enemy.data.health).toBe(9);
});
