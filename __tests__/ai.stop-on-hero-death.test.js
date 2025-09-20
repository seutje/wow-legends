import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('AI turn is skipped when opponent hero already defeated', async () => {
  const takeTurn = jest.fn();
  const g = new Game(null, { createMctsAI: async () => ({ takeTurn }) });
  g.state.difficulty = 'medium';
  g.player.hero.data.health = 0;
  await g.endTurn();
  expect(takeTurn).not.toHaveBeenCalled();
});

test('AI cannot draw or play after delivering lethal damage', async () => {
  const results = {};
  let gameRef = null;
  const aiFactory = async () => ({
    async takeTurn(player, opponent) {
      opponent.hero.data.health = 0;
      results.drawBefore = player.library.cards.length;
      results.draw = gameRef.draw(player, 1);
      results.drawAfter = player.library.cards.length;
      const card = new Card({ type: 'ally', name: 'Phantom', cost: 0 });
      player.hand.add(card);
      results.played = await gameRef.playFromHand(player, card);
    }
  });
  const g = new Game(null, { createMctsAI: aiFactory });
  gameRef = g;
  g.state.difficulty = 'medium';
  g.opponent.library.add(new Card({ type: 'spell', name: 'Ping', cost: 0 }));
  await g.endTurn();
  expect(results.drawBefore).toBe(1);
  expect(results.draw).toBe(0);
  expect(results.drawAfter).toBe(1);
  expect(results.played).toBe(false);
  expect(g.state.matchOver).toBe(true);
});
