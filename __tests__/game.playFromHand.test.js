import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('playing an ally moves it from hand to battlefield', async () => {
  const g = new Game();
  const ally = new Card({ type: 'ally', name: 'Footman', cost: 0 });
  g.player.hand.add(ally);
  const result = await g.playFromHand(g.player, ally.id);
  expect(result).toBe(true);
  expect(g.player.battlefield.cards).toContain(ally);
  expect(g.player.hand.cards).not.toContain(ally);
});
