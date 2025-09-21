import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Spell Damage +1 from Scarlet Sorcerer boosts Whirlwind', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  // Clear zones for controlled scenario
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.opponent.hero.data.armor = 0;
  g.resources._pool.set(g.player, 10);

  // Add Scarlet Sorcerer to grant Spell Damage +1
  const sorcData = g.allCards.find(c => c.id === 'ally-scarlet-sorcerer');
  const sorc = new Card(sorcData);
  g.player.battlefield.add(sorc);

  // Add Whirlwind to hand
  g.addCardToHand('spell-whirlwind');
  const whirlwind = g.player.hand.cards.find(c => c.id === 'spell-whirlwind');

  // Add an enemy minion to verify AoE damage
  const enemy = new Card({ name: 'Dummy', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  g.opponent.battlefield.add(enemy);

  const initialHeroHealth = g.opponent.hero.data.health;

  await g.playFromHand(g.player, whirlwind.id);

  expect(enemy.data.health).toBe(1); // took 2 damage instead of 1
  expect(g.opponent.hero.data.health).toBe(initialHeroHealth - 2);
});
