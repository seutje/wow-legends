import Game from '../src/js/game.js';

test('setupMatch uses provided deck', async () => {
  const game = new Game();
  game.state.difficulty = 'easy';
  const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { health: 30, armor: 0 } };
  const card = { id: 'a1', name: 'Ally', type: 'ally', text: '', data: { attack: 1, health: 1 } };
  const cards = Array(60).fill(card);
  await game.setupMatch({ hero, cards });
  expect(game.player.hero.name).toBe('Hero');
  expect(game.player.library.cards.length + game.player.hand.cards.length).toBe(60);
});

test('starting new match clears previous hand and battlefield', async () => {
  const game = new Game();
  game.state.difficulty = 'easy';
  await game.setupMatch();
  game.player.battlefield.cards.push({});
  game.opponent.battlefield.cards.push({});
  const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { health: 30, armor: 0 } };
  const card = { id: 'a1', name: 'Ally', type: 'ally', text: '', data: { attack: 1, health: 1 } };
  const cards = Array(60).fill(card);
  await game.setupMatch({ hero, cards });
  const playerStarts = game.turns.activePlayer === game.player;
  expect(game.player.hand.cards.length).toBe(playerStarts ? 4 : 3);
  expect(game.player.battlefield.cards.length).toBe(0);
  expect(game.opponent.hand.cards.length).toBe(playerStarts ? 3 : 4);
  expect(game.opponent.battlefield.cards.length).toBe(0);
});
