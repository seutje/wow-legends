import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import fs from 'fs';

test("Rexxar's hero power scales with Spell Damage bonuses", async () => {
  const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
  const rexxarData = cards.find(c => c.id === 'hero-rexxar-beastmaster');

  const g = new Game();
  await g.setupMatch();

  // Set AI hero to Rexxar and give mana/resources
  g.opponent.hero = new Hero(rexxarData);
  g.turns.turn = 2;
  g.resources.startTurn(g.opponent);
  g.turns.setActivePlayer(g.opponent);

  // Give AI +1 Spell Damage via a simple aura minion
  const sorc = new Card({ name: 'Spell Booster', type: 'ally', data: { attack: 1, health: 1, spellDamage: 1 }, keywords: [] });
  g.opponent.battlefield.add(sorc);

  // Ensure the hero is targeted
  g.rng.pick = (arr) => arr[0];
  g.player.hero.data.armor = 0;
  const before = g.player.hero.data.health;

  await g.useHeroPower(g.opponent);

  // Base 2 damage +1 from Spell Damage = 3
  expect(g.player.hero.data.health).toBe(before - 3);
});

test("Rexxar's hero power deals base 2 without Spell Damage", async () => {
  const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
  const rexxarData = cards.find(c => c.id === 'hero-rexxar-beastmaster');

  const g = new Game();
  await g.setupMatch();

  g.opponent.hero = new Hero(rexxarData);
  g.turns.turn = 2;
  g.resources.startTurn(g.opponent);
  g.turns.setActivePlayer(g.opponent);

  g.rng.pick = (arr) => arr[0];
  g.player.hero.data.armor = 0;
  const before = g.player.hero.data.health;

  await g.useHeroPower(g.opponent);

  expect(g.player.hero.data.health).toBe(before - 2);
});

