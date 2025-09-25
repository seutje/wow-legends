import fs from 'fs';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));
const lieutenantData = allyCards.find((c) => c.id === 'ally-silver-hand-lieutenant');
const recruitData = allyCards.find((c) => c.id === 'ally-silver-hand-recruit');

test('Silver Hand Lieutenant grants +1 attack to each recruit per friendly lieutenant', async () => {
  expect(lieutenantData).toBeDefined();
  expect(recruitData).toBeDefined();

  const game = new Game();
  await game.setupMatch();

  const player = game.player;
  player.hand.cards = [];
  player.battlefield.cards = [];
  game.resources._pool.set(player, 20);

  const recruitOne = new Card(recruitData);
  recruitOne.owner = player;
  player.hand.add(recruitOne);
  await game.playFromHand(player, recruitOne.id);
  expect(recruitOne.data.attack).toBe(1);

  const lieutenantOne = new Card(lieutenantData);
  lieutenantOne.owner = player;
  player.hand.add(lieutenantOne);
  await game.playFromHand(player, lieutenantOne.id);
  expect(recruitOne.data.attack).toBe(2);

  const recruitTwo = new Card(recruitData);
  recruitTwo.owner = player;
  player.hand.add(recruitTwo);
  await game.playFromHand(player, recruitTwo.id);
  expect(recruitTwo.data.attack).toBe(2);

  const lieutenantTwo = new Card(lieutenantData);
  lieutenantTwo.owner = player;
  player.hand.add(lieutenantTwo);
  await game.playFromHand(player, lieutenantTwo.id);

  expect(recruitOne.data.attack).toBe(3);
  expect(recruitTwo.data.attack).toBe(3);

  player.battlefield.remove(lieutenantOne);
  game.bus.emit('allyDefeated', { player, card: lieutenantOne });
  expect(recruitOne.data.attack).toBe(2);
  expect(recruitTwo.data.attack).toBe(2);

  player.battlefield.remove(lieutenantTwo);
  game.bus.emit('allyDefeated', { player, card: lieutenantTwo });
  expect(recruitOne.data.attack).toBe(1);
  expect(recruitTwo.data.attack).toBe(1);
});
