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

test('quests are excluded from spell target prompts', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const enemy = new Card({ name: 'Target Dummy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  const quest = new Card({ name: 'Quest', type: 'quest', data: {} });
  g.opponent.battlefield.add(enemy);
  g.opponent.battlefield.add(quest);

  g.addCardToHand('spell-lightning-bolt');
  const bolt = g.player.hand.cards.find(c => c.id === 'spell-lightning-bolt');

  const promptSpy = jest.fn(async (candidates) => {
    expect(candidates).not.toContain(quest);
    return enemy;
  });
  g.promptTarget = promptSpy;

  await g.playFromHand(g.player, bolt.id);

  expect(promptSpy).toHaveBeenCalled();
  expect(enemy.data.health).toBe(2);
  expect(g.opponent.battlefield.cards).toContain(quest);
});

test('lightning bolt can target friendly stealth allies', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const enemy = new Card({ name: 'Target Dummy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
  g.opponent.battlefield.add(enemy);

  const stealth = new Card({ name: 'Sneaky', type: 'ally', data: { attack: 0, health: 1 }, keywords: ['Stealth'] });
  g.player.battlefield.add(stealth);

  g.addCardToHand('spell-lightning-bolt');
  const bolt = g.player.hand.cards.find(c => c.id === 'spell-lightning-bolt');

  const promptSpy = jest.fn(async (candidates) => {
    expect(candidates).toContain(stealth);
    return stealth;
  });
  g.promptTarget = promptSpy;

  await g.playFromHand(g.player, bolt.id);

  expect(promptSpy).toHaveBeenCalled();
  expect(stealth.data.health).toBeLessThanOrEqual(0);
  expect(stealth.keywords).not.toContain('Stealth');
});
