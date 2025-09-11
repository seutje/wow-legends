import Game from '../src/js/game.js';

test('setupMatch uses provided deck', async () => {
  const game = new Game();
  const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { health: 30, armor: 0 } };
  const card = { id: 'a1', name: 'Ally', type: 'ally', text: '', data: { attack: 1, health: 1 } };
  const cards = Array(60).fill(card);
  await game.setupMatch({ hero, cards });
  expect(game.player.hero.name).toBe('Hero');
  expect(game.player.library.cards.length + game.player.hand.cards.length).toBe(60);
});
