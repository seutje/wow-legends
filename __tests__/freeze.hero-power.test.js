import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const cards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const jaina = cards.find(c => c.id === 'hero-jaina-proudmoore-archmage');
const thrall = cards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');

test('Frozen hero cannot use hero power until after their turn', async () => {
  const g = new Game();
  g.player.hero = new Hero(jaina);
  g.opponent.hero = new Hero(thrall);
  g.turns.setActivePlayer(g.player);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  g.promptTarget = async () => g.opponent.hero;
  await g.useHeroPower(g.player);
  expect(g.opponent.hero.data.freezeTurns).toBe(1);

  g.turns.setActivePlayer(g.opponent);
  g.turns.turn = 2;
  g.turns.startTurn();
  g.resources.startTurn(g.opponent);
  const res = await g.useHeroPower(g.opponent);
  expect(res).toBe(false);
  expect(g.opponent.hero.powerUsed).toBe(false);

  while (g.turns.current !== 'End') g.turns.nextPhase();
  g.turns.nextPhase();
  expect(g.opponent.hero.data.freezeTurns).toBe(0);
});
