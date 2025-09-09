import Game from '../src/js/game.js';

test('AI auto-selects a target without user interaction', async () => {
  const g = new Game();
  // Simulate AI's turn
  g.turns.setActivePlayer(g.opponent);
  // Pretend we are running in a browser environment
  global.document = {};
  // Deterministic RNG
  g.rng.pick = (arr) => arr[0];
  const candidates = [{ name: 'Foo' }, { name: 'Bar' }];
  const target = await g.promptTarget(candidates);
  expect(target).toBe(candidates[0]);
  delete global.document;
});
