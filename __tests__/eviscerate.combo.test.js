import fs from 'fs';
import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

const cards = JSON.parse(
  fs.readFileSync(new URL('../data/cards.json', import.meta.url))
);
const eviscerateData = cards.find(c => c.id === 'spell-eviscerate');

describe('Eviscerate combo', () => {
  test('deals 4 damage when combo is active', async () => {
    const g = new Game();
    g.resources._pool.set(g.player, 10);
    const filler = new Card({ type: 'spell', name: 'Filler', cost: 0 });
    const eviscerate = new Card(eviscerateData);
    g.player.hand.add(filler);
    g.player.hand.add(eviscerate);
    await g.playFromHand(g.player, filler.id);
    const promptSpy = jest.fn(async () => g.opponent.hero);
    g.promptTarget = promptSpy;
    await g.playFromHand(g.player, eviscerate.id);
    expect(promptSpy).toHaveBeenCalled();
    expect(g.opponent.hero.data.health).toBe(26);
  });

  test('deals 2 damage without combo', async () => {
    const g = new Game();
    g.resources._pool.set(g.player, 10);
    const eviscerate = new Card(eviscerateData);
    g.player.hand.add(eviscerate);
    const promptSpy = jest.fn(async () => g.opponent.hero);
    g.promptTarget = promptSpy;
    await g.playFromHand(g.player, eviscerate.id);
    expect(promptSpy).toHaveBeenCalled();
    expect(g.opponent.hero.data.health).toBe(28);
  });
});
