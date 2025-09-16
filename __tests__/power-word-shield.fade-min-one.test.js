import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Power Word: Shield fade safety', () => {
  test("doesn't drop target below 1 HP when expiring after damage", async () => {
    const g = new Game();
    await g.setupMatch();

    // Deterministic zones/resources
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);

    // Ally with low base health
    const ally = new Card({ name: 'Target Ally', type: 'ally', data: { attack: 1, health: 2 } });
    g.player.battlefield.add(ally);

    // Add Power Word: Shield to hand
    g.addCardToHand('spell-power-word-shield');
    const pws = g.player.hand.cards.find(c => c.id === 'spell-power-word-shield');

    // Force target to ally for PWS
    g.promptTarget = jest.fn(async (cands) => ally);

    await g.playFromHand(g.player, pws.id); // ally becomes 4 HP until next turn
    expect(ally.data.health).toBe(4);

    // Now deal 3 damage to the ally (leaves it at 1 while shield is active)
    await g.effects.dealDamage(
      { target: 'character', amount: 3 },
      { game: g, player: g.player, card: null, comboActive: false }
    );
    expect(ally.data.health).toBe(1);

    const finishTurnAndPassTo = (nextPlayer) => {
      while (g.turns.current !== 'End') g.turns.nextPhase();
      g.turns.nextPhase();
      g.turns.setActivePlayer(nextPlayer);
      g.turns.startTurn();
      g.resources.startTurn(nextPlayer);
    };

    // Opponent's turn shouldn't change the HP
    finishTurnAndPassTo(g.opponent);
    expect(ally.data.health).toBe(1);

    // Fade occurs at the start of player's next turn
    finishTurnAndPassTo(g.player);
    expect(ally.data.health).toBe(1);
    expect(ally.data.maxHealth).toBe(2);
    expect(ally.data.dead).not.toBe(true);
  });
});

