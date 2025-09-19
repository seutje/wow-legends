/** @jest-environment jsdom */
import fs from 'fs';
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

const allyCards = JSON.parse(
  fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url).pathname)
);
const waterElementalGuardian = allyCards.find(c => c.id === 'ally-water-elemental-guardian');

if (!thrallData || !powerWordShield || !waterElementalGuardian) {
  throw new Error('Required card data missing for combat log tests.');
}

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
