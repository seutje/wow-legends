import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Scarlet Sorcerer increases spell damage by 1', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const sorcData = g.allCards.find(c => c.id === 'ally-scarlet-sorcerer');
  const sorc = new Card(sorcData);
  g.player.battlefield.add(sorc);

  g.addCardToHand('spell-lightning-bolt');
  const bolt = g.player.hand.cards.find(c => c.id === 'spell-lightning-bolt');

  const enemy = new Card({ name: 'Dummy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  g.opponent.battlefield.add(enemy);
  g.promptTarget = async () => enemy;

  await g.playFromHand(g.player, bolt.id);

  expect(enemy.data.health).toBe(1);
});
