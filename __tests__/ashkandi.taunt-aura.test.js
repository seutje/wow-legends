import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

function createTauntAlly({ id, attack, health }) {
  return new Card({
    id,
    name: `Taunt Ally ${id}`,
    type: 'ally',
    cost: 0,
    data: { attack, health },
    keywords: ['Taunt']
  });
}

test('Ashkandi grants Taunt allies +1 attack while equipped', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const earlyTaunt = createTauntAlly({ id: 'ally-early-taunt', attack: 2, health: 4 });
  const nonTaunt = new Card({
    id: 'ally-non-taunt',
    name: 'Non-Taunt Ally',
    type: 'ally',
    cost: 0,
    data: { attack: 3, health: 3 },
    keywords: []
  });

  g.player.hand.add(earlyTaunt);
  g.player.hand.add(nonTaunt);
  await g.playFromHand(g.player, earlyTaunt.id);
  await g.playFromHand(g.player, nonTaunt.id);

  expect(earlyTaunt.data.attack).toBe(2);
  expect(nonTaunt.data.attack).toBe(3);

  const ashkandi = new Card({
    id: 'equipment-ashkandi-greatsword-of-the-brotherhood',
    name: 'Ashkandi, Greatsword of the Brotherhood',
    type: 'equipment',
    cost: 0,
    attack: 5,
    durability: 1,
    effects: [
      { type: 'equipmentKeywordAura', keyword: 'Taunt', attack: 1 }
    ],
  });

  g.player.hand.add(ashkandi);
  await g.playFromHand(g.player, ashkandi.id);

  expect(earlyTaunt.data.attack).toBe(3);
  expect(nonTaunt.data.attack).toBe(3);

  const laterTaunt = createTauntAlly({ id: 'ally-later-taunt', attack: 1, health: 2 });
  g.player.hand.add(laterTaunt);
  await g.playFromHand(g.player, laterTaunt.id);
  expect(laterTaunt.data.attack).toBe(2);

  const equipped = g.player.hero.equipment[0];
  expect(equipped).toBeTruthy();
  equipped.durability = 0;
  g.player.hero.equipment = [];
  g.bus.emit('damageDealt', { player: g.player, source: g.player.hero, amount: 0, target: g.opponent.hero });

  expect(earlyTaunt.data.attack).toBe(2);
  expect(laterTaunt.data.attack).toBe(1);
});
