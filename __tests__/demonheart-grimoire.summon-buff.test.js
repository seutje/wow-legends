import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Demonheart Grimoire buffs demon allies summoned after it is played', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const earlyDemon = new Card({
    id: 'ally-early-demon',
    name: 'Early Demon',
    type: 'ally',
    cost: 0,
    data: { attack: 1, health: 1 },
    keywords: ['Demon']
  });
  g.player.hand.add(earlyDemon);
  await g.playFromHand(g.player, earlyDemon.id);
  expect(earlyDemon.data.attack).toBe(1);
  expect(earlyDemon.data.health).toBe(1);

  const grimoire = new Card({
    id: 'equipment-demonheart-grimoire',
    name: 'Demonheart Grimoire',
    type: 'equipment',
    cost: 0,
    effects: [{ type: 'summonBuff', keyword: 'Demon', attack: 1, health: 1 }],
  });
  g.player.hand.add(grimoire);
  await g.playFromHand(g.player, grimoire.id);

  const laterDemon = new Card({
    id: 'ally-later-demon',
    name: 'Later Demon',
    type: 'ally',
    cost: 0,
    data: { attack: 2, health: 2 },
    keywords: ['Demon']
  });
  g.player.hand.add(laterDemon);
  await g.playFromHand(g.player, laterDemon.id);
  expect(laterDemon.data.attack).toBe(3);
  expect(laterDemon.data.health).toBe(3);

  const summoningSpell = new Card({
    id: 'spell-summon-demon',
    name: 'Summon Demon',
    type: 'spell',
    cost: 0,
    effects: [{ type: 'summon', unit: { name: 'Demon Token', attack: 1, health: 1, keywords: ['Demon'] }, count: 1 }],
  });
  g.player.hand.add(summoningSpell);
  await g.playFromHand(g.player, summoningSpell.id);
  const token = g.player.battlefield.cards.find(c => c.name === 'Demon Token');
  expect(token.data.attack).toBe(2);
  expect(token.data.health).toBe(2);

  // Early demon remains unbuffed
  expect(earlyDemon.data.attack).toBe(1);
  expect(earlyDemon.data.health).toBe(1);
});

