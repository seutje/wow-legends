import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('easy difficulty still draws at opponent turn start', async () => {
  const game = new Game();
  await game.init();
  game.state.difficulty = 'easy';

  game.opponent.hand.cards = [];
  game.opponent.library.cards = [
    new Card({ type: 'ally', name: 'Scout', cost: 1, data: { attack: 1, health: 1 } })
  ];

  const drawSpy = jest.spyOn(game, 'draw');
  try {
    game.turns.setActivePlayer(game.opponent);
    game.turns.startTurn();
    expect(drawSpy).toHaveBeenCalledWith(game.opponent, 1);
    expect(game.opponent.hand.cards).toHaveLength(1);
  } finally {
    drawSpy.mockRestore();
  }
});

test('medium difficulty MCTS turn draws only once', async () => {
  const takeTurn = jest.fn(async (player) => {
    const [card] = player.library.draw(1);
    if (card) player.hand.add(card);
  });
  const game = new Game(null, { createMctsAI: async () => ({ takeTurn }) });
  await game.init();
  game.state.difficulty = 'medium';

  game.opponent.hand.cards = [];
  const first = new Card({ type: 'ally', name: 'Pioneer', cost: 1, data: { attack: 1, health: 1 } });
  const second = new Card({ type: 'ally', name: 'Adventurer', cost: 1, data: { attack: 1, health: 1 } });
  game.opponent.library.cards = [first, second];

  const initialLibraryCount = game.opponent.library.cards.length;
  await game.endTurn();

  expect(takeTurn).toHaveBeenCalledTimes(1);
  expect(initialLibraryCount - game.opponent.library.cards.length).toBe(1);
  expect(game.opponent.hand.cards).toHaveLength(1);
  expect(game.opponent.hand.cards[0].name).toBe('Adventurer');
});
