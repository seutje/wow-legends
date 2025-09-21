import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Freezing Trap returns attacking enemy ally to hand and increases cost by 2', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  // Controlled state
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);
  g.resources._pool.set(g.opponent, 10);

  // Player plays Freezing Trap
  const ftData = g.allCards.find(c => c.id === 'spell-freezing-trap');
  const ft = new Card(ftData);
  g.player.hand.add(ft);
  await g.playFromHand(g.player, ft.id);

  // Opponent has a minion and declares an attack
  const attacker = new Card({ name: 'Test Attacker', type: 'ally', cost: 3, data: { attack: 2, health: 2 }, keywords: [] });
  g.opponent.battlefield.add(attacker);

  const result = await g.attack(g.opponent, attacker.id);

  // Attack should be canceled and minion returned with +2 cost
  expect(result).toBe(false);
  expect(g.opponent.battlefield.cards.length).toBe(0);
  const returned = g.opponent.hand.cards.find(c => c.name === 'Test Attacker');
  expect(returned).toBeTruthy();
  expect(returned.cost).toBe(5);
});
