import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const jaina = heroCards.find(c => c.id === 'hero-jaina-proudmoore-archmage');
const illidan = heroCards.find(c => c.id === 'hero-illidan-stormrage-the-betrayer');

function setupHeroPowerTest(game, heroData) {
  game.player.hero = new Hero(heroData);
  game.turns.turn = Math.max(2, game.turns.turn);
  game.resources.startTurn(game.player);
  game.turns.setActivePlayer(game.player);
}

test("Jaina's hero power scales with Spell Damage bonuses", async () => {
  expect(jaina).toBeDefined();
  const g = new Game();
  setupHeroPowerTest(g, jaina);

  const target = new Card({ name: 'Training Dummy', type: 'ally', data: { attack: 0, health: 5 } });
  g.opponent.battlefield.add(target);
  g.promptTarget = async () => target;

  g.player.hero.data.spellDamage = 1;

  const before = target.data.health;
  await g.useHeroPower(g.player);

  expect(target.data.health).toBe(before - 2);
});

test("Jaina's hero power deals base damage without Spell Damage", async () => {
  expect(jaina).toBeDefined();
  const g = new Game();
  setupHeroPowerTest(g, jaina);

  const target = new Card({ name: 'Training Dummy', type: 'ally', data: { attack: 0, health: 5 } });
  g.opponent.battlefield.add(target);
  g.promptTarget = async () => target;

  const before = target.data.health;
  await g.useHeroPower(g.player);

  expect(target.data.health).toBe(before - 1);
});

test("Illidan's hero power ignores Spell Damage bonuses", async () => {
  expect(illidan).toBeDefined();
  const g = new Game();
  setupHeroPowerTest(g, illidan);

  const enemyMinion = new Card({ name: 'Raid Dummy', type: 'ally', data: { attack: 0, health: 4 } });
  g.opponent.battlefield.add(enemyMinion);

  g.player.hero.data.spellDamage = 1;

  const heroBefore = g.opponent.hero.data.health;
  const minionBefore = enemyMinion.data.health;

  await g.useHeroPower(g.player);

  expect(g.opponent.hero.data.health).toBe(heroBefore - 1);
  expect(enemyMinion.data.health).toBe(minionBefore - 1);
});
