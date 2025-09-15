import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const cards = [
  ...read('hero'),
  ...read('spell'),
  ...read('ally'),
  ...read('equipment'),
  ...read('quest'),
  ...read('consumable'),
];
const guldanData = cards.find(c => c.id === 'hero-gul-dan-dark-conjurer');

test("Gul'dan's hero power damages his hero", async () => {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(guldanData);
  g.turns.turn = 2;
  g.resources.startTurn(g.player);
  const initialHealth = g.player.hero.data.health;
  await g.useHeroPower(g.player);
  expect(g.player.hero.data.health).toBe(initialHealth - 2);
});
