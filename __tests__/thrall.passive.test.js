import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const thrallData = heroCards.find(c => c.id === 'hero-thrall-warchief-of-the-horde');

const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));
const stormforgedTotemicData = allyCards.find(c => c.id === 'ally-stormforged-totemic');
const argentHealerData = allyCards.find(c => c.id === 'ally-argent-healer');

async function createGameWithThrall() {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(thrallData);
  g.player.hero.owner = g.player;
  return g;
}

test("Thrall's passive reduces existing Totem costs when applied", async () => {
  const g = await createGameWithThrall();
  const totem = new Card(stormforgedTotemicData);
  g.player.hand.add(totem);

  expect(totem.cost).toBe(stormforgedTotemicData.cost);

  await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });

  expect(totem.cost).toBe(Math.max(0, stormforgedTotemicData.cost - 1));
});

test("Thrall's passive reduces newly drawn Totems but leaves other cards unchanged", async () => {
  const g = await createGameWithThrall();

  await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });

  const totem = new Card(stormforgedTotemicData);
  g.player.hand.add(totem);
  expect(totem.cost).toBe(Math.max(0, stormforgedTotemicData.cost - 1));

  const nonTotem = new Card(argentHealerData);
  g.player.hand.add(nonTotem);
  expect(nonTotem.cost).toBe(argentHealerData.cost);
});

test("Thrall's passive does not stack across multiple applications", async () => {
  const g = await createGameWithThrall();

  const totem = new Card(stormforgedTotemicData);
  g.player.hand.add(totem);

  await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });
  const reducedOnce = totem.cost;

  await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });

  expect(totem.cost).toBe(reducedOnce);
});
