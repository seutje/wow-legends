import Game from '../src/js/game.js';

test('setupMatch creates a 60 card library', async () => {
  const g = new Game();
  await g.setupMatch();
  expect(g.player.library.cards.length + g.player.hand.cards.length).toBe(61);
  expect(g.opponent.library.cards.length + g.opponent.hand.cards.length).toBe(60);
});

test('setupMatch assigns different heroes to players', async () => {
  const g = new Game();
  await g.setupMatch();
  expect(g.player.hero).toBeDefined();
  expect(g.opponent.hero).toBeDefined();
  expect(g.player.hero.id).not.toBe(g.opponent.hero.id);
});