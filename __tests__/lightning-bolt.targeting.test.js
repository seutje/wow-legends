import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('playing Lightning Bolt prompts for a target', async () => {
  const g = new Game();
  await g.setupMatch();

  // Clean zones for determinism
  g.player.hand.cards = [];
  g.opponent.battlefield.cards = [];

  // Ensure sufficient resources
  g.resources._pool.set(g.player, 10);

  // Add an enemy to target
  const enemy = new Card({ name: 'Target Dummy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  g.opponent.battlefield.add(enemy);

  // Add Lightning Bolt to hand
  g.addCardToHand('spell-lightning-bolt');
  const bolt = g.player.hand.cards.find(c => c.id === 'spell-lightning-bolt');

  // Spy on target prompt
  const promptSpy = jest.fn(async () => enemy);
  g.promptTarget = promptSpy;

  await g.playFromHand(g.player, bolt.id);

  expect(promptSpy).toHaveBeenCalled();
  expect(enemy.data.health).toBe(2); // 5 - 3 damage
});

