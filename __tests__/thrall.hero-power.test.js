import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const thrallData = cards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');

test("Thrall's hero power applies Overload 1", async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(thrallData);
  g.promptTarget = async () => null;
  await g.useHeroPower(g.player);
  expect(g.resources._overloadNext.get(g.player)).toBe(1);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  expect(g.resources.pool(g.player)).toBe(1);
});
