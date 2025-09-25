import fs from 'fs';
import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const cards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const malfData = cards.find(c => c.id === 'hero-malfurion-stormrage-archdruid');
const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));
const keeperData = allyCards.find(c => c.id === 'ally-keeper-of-the-grove');

async function activateMalfurionPassive(game) {
  if (!game.player?.hero?.passive?.length) return;
  await game.effects.execute(game.player.hero.passive, {
    game,
    player: game.player,
    card: game.player.hero,
  });
}

async function setupGameWithMalfurion() {
  const game = new Game();
  await game.setupMatch();
  game.player.hero = new Hero(malfData);
  game.player.hero.owner = game.player;
  await activateMalfurionPassive(game);
  return game;
}

test("Malfurion's hero power offers a choice", async () => {
  const g = await setupGameWithMalfurion();
  g.turns.turn = 2;
  g.turns.setActivePlayer(g.player);
  g.resources.startTurn(g.player);
  const spy = jest.fn(async () => 0);
  g.promptOption = spy;
  await g.useHeroPower(g.player);
  expect(spy).toHaveBeenCalledWith(["+1 ATK this turn", "Gain 2 Armor"]);
});

test("Malfurion's hero power can grant attack", async () => {
  const g = await setupGameWithMalfurion();
  g.turns.turn = 2;
  g.turns.setActivePlayer(g.player);
  g.resources.startTurn(g.player);
  g.promptOption = async () => 0; // choose attack option
  await g.useHeroPower(g.player);
  expect(g.player.hero.data.attack).toBe(1);
  expect(g.player.hero.data.armor).toBe(0);
  expect(g.resources.pool(g.player)).toBe(0);
});

test("Malfurion's hero power can grant armor", async () => {
  const g = await setupGameWithMalfurion();
  g.turns.turn = 2;
  g.turns.setActivePlayer(g.player);
  g.resources.startTurn(g.player);
  g.promptOption = async () => 1; // choose armor option
  await g.useHeroPower(g.player);
  expect(g.player.hero.data.attack).toBe(0);
  expect(g.player.hero.data.armor).toBe(2);
  expect(g.resources.pool(g.player)).toBe(0);
});

test("Malfurion's hero power grants both effects after spending four mana", async () => {
  const g = await setupGameWithMalfurion();
  g.turns.turn = 4;
  g.turns.setActivePlayer(g.player);
  g.resources.startTurn(g.player);
  const optionSpy = jest.fn();
  g.promptOption = optionSpy;
  g.bus.emit('resources:spent', { player: g.player, amount: 4 });
  await g.useHeroPower(g.player);
  expect(optionSpy).not.toHaveBeenCalled();
  expect(g.player.hero.data.attack).toBe(1);
  expect(g.player.hero.data.armor).toBe(2);
});

test("Malfurion resolves both options on choose one allies after spending four mana", async () => {
  expect(keeperData).toBeDefined();
  const g = await setupGameWithMalfurion();
  g.turns.turn = 5;
  g.turns.setActivePlayer(g.player);
  g.resources.startTurn(g.player);
  g.resources._pool.set(g.player, 10);
  g.player.hand.cards = [];
  const keeper = new Card(keeperData);
  g.player.hand.add(keeper);
  g.player.hero.data.health = 25;
  g.player.hero.data.maxHealth = 30;
  const targets = [g.opponent.hero, g.player.hero];
  g.promptTarget = jest.fn(async () => targets.shift());
  const optionSpy = jest.fn();
  g.promptOption = optionSpy;
  g.bus.emit('resources:spent', { player: g.player, amount: 4 });
  const played = await g.playFromHand(g.player, keeper.id);
  expect(played).toBe(true);
  expect(optionSpy).not.toHaveBeenCalled();
  expect(g.promptTarget).toHaveBeenCalledTimes(2);
  expect(g.opponent.hero.data.health).toBe(28);
  expect(g.player.hero.data.health).toBe(27);
});
