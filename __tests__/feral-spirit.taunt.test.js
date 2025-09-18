import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Feral Spirit summons taunt wolves for the opponent', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.resources._pool.set(g.opponent, 10);
  g.turns.turn = 10;
  g.turns.setActivePlayer(g.opponent);

  const feralSpiritData = g.allCards.find(c => c.id === 'spell-feral-spirit');
  const feralSpirit = new Card(feralSpiritData);
  g.opponent.hand.add(feralSpirit);

  await g.playFromHand(g.opponent, feralSpirit.id);

  const wolves = g.opponent.battlefield.cards.filter(c => c.name === 'Spirit Wolf');
  expect(wolves).toHaveLength(2);
  expect(wolves.every(w => w.keywords?.includes('Taunt'))).toBe(true);
});

