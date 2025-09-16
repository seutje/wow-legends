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
const footpadData = cards.find(c => c.id === 'ally-defias-footpad');

describe('Defias Footpad combo', () => {
  test('summons an extra Footpad when combo is active', async () => {
    const g = new Game();
    g.resources._pool.set(g.player, 10);
    const filler = new Card({ type: 'spell', name: 'Filler', cost: 0 });
    const footpad = new Card(footpadData);
    g.player.hand.add(filler);
    g.player.hand.add(footpad);
    await g.playFromHand(g.player, filler.id);
    await g.playFromHand(g.player, footpad.id);
    const footpads = g.player.battlefield.cards.filter(c => c.name === 'Defias Footpad');
    expect(footpads).toHaveLength(2);
  });

  test('only summons itself without combo', async () => {
    const g = new Game();
    g.resources._pool.set(g.player, 10);
    const footpad = new Card(footpadData);
    g.player.hand.add(footpad);
    await g.playFromHand(g.player, footpad.id);
    const footpads = g.player.battlefield.cards.filter(c => c.name === 'Defias Footpad');
    expect(footpads).toHaveLength(1);
  });
});
