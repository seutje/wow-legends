import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('using Healing Potion prompts for target and respects enemy Taunt', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();
  g.turns.setActivePlayer(g.player);
  g.turns.startTurn();

  // Reset zones for determinism
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];

  // Ensure resources and reduced hero health
  g.resources._pool.set(g.player, 10);
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 20;

  // Friendly ally to ensure allies are targetable
  const ally = new Card({ name: 'Friendly', type: 'ally', data: { attack: 0, health: 1 } });
  g.player.battlefield.add(ally);

  // Enemy with Taunt and another without
  const taunt = new Card({ name: 'Taunt Enemy', type: 'ally', data: { attack: 0, health: 5 }, keywords: ['Taunt'] });
  const other = new Card({ name: 'Other Enemy', type: 'ally', data: { attack: 0, health: 5 } });
  g.opponent.battlefield.add(taunt);
  g.opponent.battlefield.add(other);

  // Add Healing Potion to hand
  g.addCardToHand('consumable-healing-potion');
  const potion = g.player.hand.cards.find(c => c.id === 'consumable-healing-potion');

  const promptSpy = jest.fn(async (candidates) => {
    expect(candidates).toContain(g.player.hero);
    expect(candidates).toContain(ally);
    expect(candidates).toContain(taunt);
    expect(candidates).not.toContain(other);
    expect(candidates).not.toContain(g.opponent.hero);
    return g.player.hero; // choose hero to heal
  });
  g.promptTarget = promptSpy;

  await g.playFromHand(g.player, potion.id);

  expect(promptSpy).toHaveBeenCalled();
  expect(g.player.hero.data.health).toBe(25);
});
