/** @jest-environment jsdom */
import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const cards = JSON.parse(
  fs.readFileSync(new URL('../data/hero.json', import.meta.url).pathname)
);
const thrallData = cards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');

test('logs when player uses hero power', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.opponent.hero = new Hero(thrallData);
  g.turns.setActivePlayer(g.player);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  // Avoid any target selection prompts during tests
  g.promptTarget = async () => null;

  const ok = await g.useHeroPower(g.player);
  expect(ok).toBe(true);
  expect(g.player.log[g.player.log.length - 1]).toBe('Used hero power');
});

test('logs when AI uses hero power', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.opponent.hero = new Hero(thrallData);
  g.turns.setActivePlayer(g.opponent);
  g.turns.turn = 2;
  g.resources.startTurn(g.opponent);
  // Avoid any target selection prompts during tests
  g.promptTarget = async () => null;

  const ok = await g.useHeroPower(g.opponent);
  expect(ok).toBe(true);
  expect(g.opponent.log[g.opponent.log.length - 1]).toBe('Used hero power');
});
