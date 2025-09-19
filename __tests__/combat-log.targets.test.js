/** @jest-environment jsdom */
import fs from 'fs';
import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(
  fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url).pathname)
);
const thrallData = heroCards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');

const spellCards = JSON.parse(
  fs.readFileSync(new URL('../data/cards/spell.json', import.meta.url).pathname)
);
const powerWordShield = spellCards.find(c => c.id === 'spell-power-word-shield');
const shadowWordPain = spellCards.find(c => c.id === 'spell-shadow-word-pain');
const explosiveTrap = spellCards.find(c => c.id === 'spell-explosive-trap');

const allyCards = JSON.parse(
  fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url).pathname)
);
const waterElementalGuardian = allyCards.find(c => c.id === 'ally-water-elemental-guardian');

if (!thrallData || !powerWordShield || !shadowWordPain || !waterElementalGuardian || !explosiveTrap) {
  throw new Error('Required card data missing for combat log tests.');
}

const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = async (input) => {
    try {
      const url = typeof input === 'string' ? new URL(input, import.meta.url) : input;
      const path = fileURLToPath(url);
      const data = JSON.parse(fs.readFileSync(path, 'utf8'));
      return {
        ok: true,
        async json() {
          return data;
        },
      };
    } catch (err) {
      return {
        ok: false,
        async json() {
          throw err;
        },
      };
    }
  };
});

afterAll(() => {
  global.fetch = originalFetch;
});

test('logs targeted actions when playing a spell', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;
  g.opponent.hero = new Hero(thrallData);
  g.opponent.hero.owner = g.opponent;

  const target = new Card(waterElementalGuardian);
  target.owner = g.player;
  g.player.battlefield.add(target);

  const spell = new Card(powerWordShield);
  spell.owner = g.player;
  g.player.hand.add(spell);

  g.turns.setActivePlayer(g.player);
  g.turns.turn = 5;
  g.resources.startTurn(g.player);

  g.promptTarget = async () => target;

  const ok = await g.playFromHand(g.player, spell);
  expect(ok).toBe(true);

  const lastLog = g.player.log[g.player.log.length - 1];
  expect(lastLog).toBe(`Played ${spell.name} targeting ${target.name}`);
});

test('auto-selected destroy effects still log their target', async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;
  g.opponent.hero = new Hero(thrallData);
  g.opponent.hero.owner = g.opponent;

  const enemy = new Card(waterElementalGuardian);
  enemy.owner = g.opponent;
  g.opponent.battlefield.add(enemy);

  const spell = new Card(shadowWordPain);
  spell.owner = g.player;
  g.player.hand.add(spell);

  g.turns.setActivePlayer(g.player);
  g.turns.turn = 5;
  g.resources.startTurn(g.player);

  const formatSpy = jest.spyOn(g, '_formatLogWithTargets');
  const ok = await g.playFromHand(g.player, spell);
  expect(ok).toBe(true);

  expect(formatSpy).toHaveBeenCalled();
  const [, targets] = formatSpy.mock.calls[formatSpy.mock.calls.length - 1];
  expect(targets).toContain(enemy);
  formatSpy.mockRestore();

  const lastLog = g.player.log[g.player.log.length - 1];
  expect(lastLog).toBe(`Played ${spell.name} targeting ${enemy.name}`);
});

test('AI auto-selected destroy effects log their target', async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;
  g.opponent.hero = new Hero(thrallData);
  g.opponent.hero.owner = g.opponent;

  const target = new Card(waterElementalGuardian);
  target.owner = g.player;
  g.player.battlefield.add(target);

  const spell = new Card(shadowWordPain);
  spell.owner = g.opponent;
  g.opponent.hand.add(spell);

  g.turns.setActivePlayer(g.opponent);
  g.turns.turn = 5;
  g.resources.startTurn(g.opponent);

  const formatSpy = jest.spyOn(g, '_formatLogWithTargets');
  const ok = await g.playFromHand(g.opponent, spell);
  expect(ok).toBe(true);

  expect(formatSpy).toHaveBeenCalled();
  const [, targets] = formatSpy.mock.calls[formatSpy.mock.calls.length - 1];
  expect(targets).toContain(target);
  formatSpy.mockRestore();

  const lastLog = g.opponent.log[g.opponent.log.length - 1];
  expect(lastLog).toBe(`Played ${spell.name} targeting ${target.name}`);
});

test('auto-target logging falls back when target capture is unavailable', async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;
  g.opponent.hero = new Hero(thrallData);
  g.opponent.hero.owner = g.opponent;

  const enemy = new Card(waterElementalGuardian);
  enemy.owner = g.opponent;
  g.opponent.battlefield.add(enemy);

  const spell = new Card(shadowWordPain);
  spell.owner = g.player;
  g.player.hand.add(spell);

  g.turns.setActivePlayer(g.player);
  g.turns.turn = 5;
  g.resources.startTurn(g.player);

  const originalRecord = g.recordActionTarget;
  g.recordActionTarget = () => {};

  const ok = await g.playFromHand(g.player, spell);
  expect(ok).toBe(true);

  g.recordActionTarget = originalRecord;

  const lastLog = g.player.log[g.player.log.length - 1];
  expect(lastLog).toBe(`Played ${spell.name} targeting ${enemy.name}`);
});

test('AI secrets are obscured in combat log entries', async () => {
  const g = new Game();
  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;
  g.opponent.hero = new Hero(thrallData);
  g.opponent.hero.owner = g.opponent;

  const secret = new Card(explosiveTrap);
  secret.owner = g.opponent;
  g.opponent.hand.add(secret);

  g.turns.setActivePlayer(g.opponent);
  g.turns.turn = 5;
  g.resources.startTurn(g.opponent);

  const ok = await g.playFromHand(g.opponent, secret);
  expect(ok).toBe(true);

  const lastLog = g.opponent.log[g.opponent.log.length - 1];
  expect(lastLog).toBe('Played a secret');
});
