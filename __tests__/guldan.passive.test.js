import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const guldanData = heroCards.find(c => c.id === 'hero-gul-dan-dark-conjurer');

async function createGameWithGuldan() {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  g.player.hero = new Hero(guldanData);
  g.player.hero.owner = g.player;

  if (g.player.hero.passive?.length) {
    await g.effects.execute(g.player.hero.passive, { game: g, player: g.player, card: g.player.hero });
  }

  return g;
}

test("Gul'dan's passive grants +1 attack to Demon allies you play", async () => {
  const g = await createGameWithGuldan();

  const demon = new Card({
    id: 'ally-guldan-test-demon',
    name: 'Test Demon',
    type: 'ally',
    cost: 0,
    data: { attack: 2, health: 3 },
    keywords: ['Demon']
  });
  g.player.hand.add(demon);
  await g.playFromHand(g.player, demon.id);
  expect(demon.data.attack).toBe(3);
  expect(demon.data.health).toBe(3);

  const soldier = new Card({
    id: 'ally-guldan-test-soldier',
    name: 'Test Soldier',
    type: 'ally',
    cost: 0,
    data: { attack: 4, health: 4 },
    keywords: []
  });
  g.player.hand.add(soldier);
  await g.playFromHand(g.player, soldier.id);
  expect(soldier.data.attack).toBe(4);
  expect(soldier.data.health).toBe(4);
});

test("Gul'dan's passive also buffs Demons summoned by other effects", async () => {
  const g = await createGameWithGuldan();

  const summonSpell = new Card({
    id: 'spell-guldan-summon-demon',
    name: 'Summon Demon',
    type: 'spell',
    cost: 0,
    effects: [
      {
        type: 'summon',
        unit: { id: 'token-guldan-imp', name: 'Summoned Imp', attack: 1, health: 1, keywords: ['Demon'] },
        count: 1
      }
    ]
  });

  g.player.hand.add(summonSpell);
  await g.playFromHand(g.player, summonSpell.id);

  const token = g.player.battlefield.cards.find(c => c.id === 'token-guldan-imp');
  expect(token).toBeTruthy();
  expect(token.data.attack).toBe(2);
  expect(token.data.health).toBe(1);
});
