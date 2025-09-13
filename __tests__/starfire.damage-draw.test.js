import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Starfire', () => {
  test('deals 5 damage to chosen target and draws a card', async () => {
    const g = new Game();
    await g.setupMatch();

    // Deterministic setup
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);

    // Add a friendly ally we can target
    const ally = new Card({ name: 'Target Ally', type: 'ally', data: { attack: 0, health: 6 }, keywords: [] });
    g.player.battlefield.add(ally);

    const initialHand = g.player.hand.cards.length;

    // Add Starfire and force target selection to the friendly ally
    g.addCardToHand('spell-starfire');
    const starfire = g.player.hand.cards.find(c => c.id === 'spell-starfire');
    const promptSpy = jest.fn(async () => ally);
    g.promptTarget = promptSpy;

    await g.playFromHand(g.player, starfire.id);

    // Damage applied to chosen target
    expect(promptSpy).toHaveBeenCalled();
    expect(ally.data.health).toBe(1); // 6 - 5

    // Draw a card (net +1 relative to initial hand)
    expect(g.player.hand.cards.length).toBe(initialHand + 1);
  });

  test('can target enemy hero (any character)', async () => {
    const g = new Game();
    await g.setupMatch();

    g.player.hand.cards = [];
    g.resources._pool.set(g.player, 10);

    const initialHand = g.player.hand.cards.length;
    const enemyHero = g.opponent.hero;
    enemyHero.data.health = 20;

    g.addCardToHand('spell-starfire');
    const starfire = g.player.hand.cards.find(c => c.id === 'spell-starfire');
    g.promptTarget = jest.fn(async () => enemyHero);

    await g.playFromHand(g.player, starfire.id);

    expect(enemyHero.data.health).toBe(15);
    expect(g.player.hand.cards.length).toBe(initialHand + 1);
  });
});

