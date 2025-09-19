import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

/**
 * Blessing of Kings and Mark of the Wild should only target allied minions.
 */
describe('Ally-only buff targeting', () => {
  test.each([
    ['Blessing of Kings', 'spell-blessing-of-kings', { attack: 4, health: 4 }],
    ['Mark of the Wild', 'spell-mark-of-the-wild', { attack: 2, health: 2 }],
  ])('%s cannot target heroes', async (_name, cardId, buff) => {
    const g = new Game();
    await g.setupMatch();

    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);

    const ally = new Card({ name: 'Target Ally', type: 'ally', data: { attack: 2, health: 3 } });
    g.player.battlefield.add(ally);

    g.addCardToHand(cardId);
    const card = g.player.hand.cards.find((c) => c.id === cardId);

    const promptSpy = jest.fn(async (candidates) => {
      expect(candidates).toContain(ally);
      expect(candidates).not.toContain(g.player.hero);
      expect(candidates).not.toContain(g.opponent.hero);
      return ally;
    });
    g.promptTarget = promptSpy;

    const beforeAttack = ally.data.attack;
    const beforeHealth = ally.data.health;

    await g.playFromHand(g.player, card.id);

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(ally.data.attack).toBe(beforeAttack + buff.attack);
    expect(ally.data.health).toBe(beforeHealth + buff.health);
  });
});
