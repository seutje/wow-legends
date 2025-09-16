import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Scroll of Fortune team buff', () => {
  test('gives all friendlies +0/+2 until next turn and draws a card', async () => {
    const g = new Game();
    await g.setupMatch();

    // Deterministic setup
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);

    const allyOne = new Card({ name: 'Guard', type: 'ally', data: { attack: 1, health: 2 } });
    const allyTwo = new Card({ name: 'Scout', type: 'ally', data: { attack: 2, health: 3 } });
    g.player.battlefield.add(allyOne);
    g.player.battlefield.add(allyTwo);

    const heroBaseHealth = g.player.hero.data.health;
    const heroBaseMax = g.player.hero.data.maxHealth ?? heroBaseHealth;
    const allyOneBase = allyOne.data.health;
    const allyTwoBase = allyTwo.data.health;

    const initialHand = g.player.hand.cards.length;
    g.addCardToHand('consumable-scroll-of-fortitude');
    const scroll = g.player.hand.cards.find(c => c.id === 'consumable-scroll-of-fortitude');

    await g.playFromHand(g.player, scroll.id);

    // Draw replaces the consumable, net +1 relative to initial state
    expect(g.player.hand.cards.length).toBe(initialHand + 1);

    // Every friendly character gains +2 health (and max health)
    expect(g.player.hero.data.health).toBe(heroBaseHealth + 2);
    expect(g.player.hero.data.maxHealth).toBe(heroBaseMax + 2);
    expect(allyOne.data.health).toBe(allyOneBase + 2);
    expect(allyOne.data.maxHealth).toBe(allyOneBase + 2);
    expect(allyTwo.data.health).toBe(allyTwoBase + 2);
    expect(allyTwo.data.maxHealth).toBe(allyTwoBase + 2);

    // Deal damage while the buff is active to test the 1 HP floor on expiry
    g.promptTarget = jest.fn(async () => allyOne);
    await g.effects.dealDamage(
      { target: 'character', amount: allyOneBase + 1 },
      { game: g, player: g.player, card: null, comboActive: false }
    );
    expect(allyOne.data.health).toBe(1);

    const finishTurnAndPassTo = (nextPlayer) => {
      while (g.turns.current !== 'End') g.turns.nextPhase();
      g.turns.nextPhase();
      g.turns.setActivePlayer(nextPlayer);
      g.turns.startTurn();
      g.resources.startTurn(nextPlayer);
    };

    // Opponent's turn: buff should persist
    finishTurnAndPassTo(g.opponent);
    expect(allyOne.data.health).toBe(1);
    expect(allyTwo.data.health).toBe(allyTwoBase + 2);
    expect(g.player.hero.data.health).toBe(heroBaseHealth + 2);

    // Player's next turn: buff should expire without killing damaged allies
    finishTurnAndPassTo(g.player);
    expect(allyOne.data.health).toBe(1);
    expect(allyOne.data.maxHealth).toBe(allyOneBase);
    expect(allyTwo.data.health).toBe(allyTwoBase);
    expect(allyTwo.data.maxHealth).toBe(allyTwoBase);
    expect(g.player.hero.data.health).toBe(heroBaseHealth);
    expect(g.player.hero.data.maxHealth).toBe(heroBaseMax);
  });
});
