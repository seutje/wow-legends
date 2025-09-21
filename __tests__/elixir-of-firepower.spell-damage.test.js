import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Elixir of Firepower grants +1 spell damage for this turn', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  // Controlled setup
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.opponent.hero.data.armor = 0;
  g.resources._pool.set(g.player, 10);

  // Enemy target
  const enemy = new Card({ name: 'Dummy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  g.opponent.battlefield.add(enemy);
  g.promptTarget = async () => enemy;

  // Add Elixir and Lightning Bolt
  g.addCardToHand('consumable-elixir-of-firepower');
  g.addCardToHand('spell-lightning-bolt');

  // Play Elixir first
  await g.playFromHand(g.player, 'consumable-elixir-of-firepower');

  // Now Lightning Bolt should hit for 4 (3 base + 1 spell damage)
  await g.playFromHand(g.player, 'spell-lightning-bolt');
  expect(enemy.data.health).toBe(1);

  // End of turn should remove the temporary spell damage buff
  g.turns.bus.emit('phase:end', { phase: 'End' });
  const sd = g.player.hero?.data?.spellDamage || 0;
  expect(sd).toBe(0);
});
