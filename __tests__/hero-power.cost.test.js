/** @jest-environment jsdom */
import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import { renderPlay } from '../src/js/ui/play.js';

const cards = JSON.parse(
  fs.readFileSync(new URL('../data/cards.json', import.meta.url).pathname)
);
const thrallData = cards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');

test('Hero power requires 2 mana', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.turns.setActivePlayer(g.player);
  g.turns.turn = 1;
  g.resources.startTurn(g.player);
  const result = await g.useHeroPower(g.player);
  expect(result).toBe(false);
  expect(g.resources.pool(g.player)).toBe(1);
  expect(g.player.hero.powerUsed).toBe(false);
});

test('Hero power button disabled when insufficient mana', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.opponent.hero = new Hero(thrallData);
  g.turns.setActivePlayer(g.player);
  g.turns.turn = 1;
  g.resources.startTurn(g.player);
  const container = document.createElement('div');
  renderPlay(container, g);
  let btn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Hero Power');
  expect(btn.disabled).toBe(true);
});

test('Hero power button enabled when sufficient mana', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.opponent.hero = new Hero(thrallData);
  g.turns.setActivePlayer(g.player);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  const container = document.createElement('div');
  renderPlay(container, g);
  const btn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Hero Power');
  expect(btn.disabled).toBe(false);
});
