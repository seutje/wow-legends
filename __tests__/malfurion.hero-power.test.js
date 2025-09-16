import fs from 'fs';
import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const cards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const malfData = cards.find(c => c.id === 'hero-malfurion-stormrage-archdruid');

test("Malfurion's hero power offers a choice", async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(malfData);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  const spy = jest.fn(async () => 0);
  g.promptOption = spy;
  await g.useHeroPower(g.player);
  expect(spy).toHaveBeenCalledWith(["+1 ATK this turn", "Gain 2 Armor"]);
});

test("Malfurion's hero power can grant attack", async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(malfData);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  g.promptOption = async () => 0; // choose attack option
  await g.useHeroPower(g.player);
  expect(g.player.hero.data.attack).toBe(1);
  expect(g.player.hero.data.armor).toBe(0);
  expect(g.resources.pool(g.player)).toBe(0);
});

test("Malfurion's hero power can grant armor", async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(malfData);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  g.promptOption = async () => 1; // choose armor option
  await g.useHeroPower(g.player);
  expect(g.player.hero.data.attack).toBe(0);
  expect(g.player.hero.data.armor).toBe(2);
  expect(g.resources.pool(g.player)).toBe(0);
});
