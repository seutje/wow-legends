import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Darnassian Huntress prompts for beast target and buffs it', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const friendlyBeast = new Card({ name: 'Friendly Beast', type: 'ally', data: { attack: 2, health: 2 }, keywords: ['Beast'] });
  const enemyBeast = new Card({ name: 'Enemy Beast', type: 'ally', data: { attack: 1, health: 3 }, keywords: ['Beast'] });
  const nonBeast = new Card({ name: 'Non Beast', type: 'ally', data: { attack: 1, health: 1 }, keywords: [] });
  g.player.battlefield.add(friendlyBeast);
  g.player.battlefield.add(nonBeast);
  g.opponent.battlefield.add(enemyBeast);

  g.addCardToHand('ally-darnassian-huntress');
  const huntress = g.player.hand.cards.find(c => c.id === 'ally-darnassian-huntress');

  const promptSpy = jest.fn(async candidates => {
    expect(candidates).toContain(friendlyBeast);
    expect(candidates).toContain(enemyBeast);
    expect(candidates).not.toContain(nonBeast);
    return enemyBeast;
  });
  g.promptTarget = promptSpy;

  await g.playFromHand(g.player, huntress.id);

  expect(promptSpy).toHaveBeenCalled();
  expect(enemyBeast.data.attack).toBe(2); // 1 + 1
  expect(enemyBeast.data.health).toBe(4); // 3 + 1
  expect(enemyBeast.keywords).toContain('Rush');
});
