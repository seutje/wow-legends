import fs from 'fs';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/cards/${name}.json`, import.meta.url)));
const cards = [
  ...read('hero'),
  ...read('spell'),
  ...read('ally'),
  ...read('equipment'),
  ...read('quest'),
  ...read('consumable'),
];
const questData = cards.find(c => c.id === 'quest-trial-of-the-elements');
const elementalData = cards.find(c => c.id === 'spell-water-elemental');
const fillerData = cards.find(c => c.id === 'spell-fireball');

test('quest rewards trigger when requirements met', async () => {
  const g = new Game();

  const quest = new Card(questData);
  const makeElem = () => new Card({ ...elementalData, id: undefined });
  const e1 = makeElem();
  const e2 = makeElem();
  const e3 = makeElem();
  const filler = new Card({ ...fillerData, id: undefined });

  g.player.hand.add(quest);
  g.player.hand.add(e1);
  g.player.hand.add(e2);
  g.player.hand.add(e3);
  g.player.library.add(filler);

  g.resources.startTurn(g.player);
  g.resources._pool.set(g.player, 20);

  await g.playFromHand(g.player, quest.id);
  expect(g.player.battlefield.cards.some(c => c.id === quest.id)).toBe(true);
  await g.playFromHand(g.player, e1.id);
  await g.playFromHand(g.player, e2.id);
  await g.playFromHand(g.player, e3.id);

  expect(g.player.battlefield.cards.some(c => c.id === quest.id)).toBe(false);
  expect(g.player.hand.cards.some(c => c.id === filler.id)).toBe(true);
});
