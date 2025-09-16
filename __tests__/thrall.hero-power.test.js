import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const thrallData = heroCards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');
const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));
const dalaranEvokerData = allyCards.find(c => c.id === 'ally-dalaran-evoker');

test("Thrall's hero power applies Overload 1", async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(thrallData);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  g.promptTarget = async () => null;
  await g.useHeroPower(g.player);
  expect(g.resources.pool(g.player)).toBe(0);
  expect(g.resources._overloadNext.get(g.player)).toBe(1);
  g.turns.turn = 3;
  g.resources.startTurn(g.player);
  expect(g.resources.pool(g.player)).toBe(2);
});

test("Thrall's hero power gains Spell Damage from Dalaran Evoker", async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;

  const evoker = new Card(dalaranEvokerData);
  evoker.owner = g.player;
  g.player.battlefield.add(evoker);

  g.opponent.hero.data.armor = 0;
  const firstTarget = new Card({ name: 'Target Dummy A', type: 'ally', data: { attack: 0, health: 3 } });
  const secondTarget = new Card({ name: 'Target Dummy B', type: 'ally', data: { attack: 0, health: 3 } });
  firstTarget.owner = g.opponent;
  secondTarget.owner = g.opponent;
  g.opponent.battlefield.add(firstTarget);
  g.opponent.battlefield.add(secondTarget);

  const enemyHeroStart = g.opponent.hero.data.health;
  const firstStart = firstTarget.data.health;
  const secondStart = secondTarget.data.health;

  const picks = [g.opponent.hero, firstTarget, secondTarget];
  let pickIndex = 0;
  g.promptTarget = async () => picks[pickIndex++] ?? null;

  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  g.turns.setActivePlayer(g.player);

  await g.useHeroPower(g.player);

  expect(g.opponent.hero.data.health).toBe(enemyHeroStart - 2);
  expect(firstTarget.data.health).toBe(firstStart - 2);
  expect(secondTarget.data.health).toBe(secondStart - 2);
});
