import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const rexxarData = heroCards.find(c => c.id === 'hero-rexxar-beastmaster');

const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));
const ironfurGrizzlyData = allyCards.find(c => c.id === 'ally-ironfur-grizzly');
const reefCrawlerData = allyCards.find(c => c.id === 'ally-reef-crawler');
const argentHealerData = allyCards.find(c => c.id === 'ally-argent-healer');

async function createGameWithRexxar() {
  const g = new Game();
  await g.setupMatch();
  g.player.hero = new Hero(rexxarData);
  g.player.hero.owner = g.player;
  return g;
}

test("Rexxar's passive reduces Beast allies without dropping below 1", async () => {
  const g = await createGameWithRexxar();

  const beast = new Card(ironfurGrizzlyData);
  const cheapBeast = new Card(reefCrawlerData);
  const nonBeast = new Card(argentHealerData);

  g.player.hand.add(beast);
  g.player.hand.add(cheapBeast);
  g.player.hand.add(nonBeast);

  expect(beast.cost).toBe(ironfurGrizzlyData.cost);
  expect(cheapBeast.cost).toBe(reefCrawlerData.cost);
  expect(nonBeast.cost).toBe(argentHealerData.cost);

  await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });

  expect(beast.cost).toBe(Math.max(1, ironfurGrizzlyData.cost - 1));
  expect(cheapBeast.cost).toBe(1);
  expect(nonBeast.cost).toBe(argentHealerData.cost);
});

test("Rexxar's passive also applies to Beast allies drawn later", async () => {
  const g = await createGameWithRexxar();

  await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });

  const beast = new Card(ironfurGrizzlyData);
  g.player.hand.add(beast);
  expect(beast.cost).toBe(Math.max(1, ironfurGrizzlyData.cost - 1));

  const cheapBeast = new Card(reefCrawlerData);
  g.player.hand.add(cheapBeast);
  expect(cheapBeast.cost).toBe(1);

  const nonBeast = new Card(argentHealerData);
  g.player.hand.add(nonBeast);
  expect(nonBeast.cost).toBe(argentHealerData.cost);
});
