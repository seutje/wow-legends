import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Power Word: Shield', () => {
  test('prompts for a target, grants +0/+2 until next turn, and draws a card', async () => {
    const g = new Game();
    await g.setupMatch();

    // Reset zones for determinism
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);

    // Add a friendly ally to target
    const ally = new Card({ name: 'Target Ally', type: 'ally', data: { attack: 1, health: 2 } });
    g.player.battlefield.add(ally);

    const initialHand = g.player.hand.cards.length;

    // Add Power Word: Shield to hand
    g.addCardToHand('spell-power-word-shield');
    const pws = g.player.hand.cards.find(c => c.id === 'spell-power-word-shield');

    // Force target selection to the ally
    const promptSpy = jest.fn(async (candidates) => {
      // Should only include friendlies for positive buffs
      expect(candidates).toContain(g.player.hero);
      expect(candidates).toContain(ally);
      expect(candidates).not.toContain(g.opponent.hero);
      return ally;
    });
    g.promptTarget = promptSpy;

    const beforeHp = ally.data.health;
    await g.playFromHand(g.player, pws.id);

    // Target UI invoked and buff applied
    expect(promptSpy).toHaveBeenCalled();
    expect(ally.data.health).toBe(beforeHp + 2);

    // Draw a card (net +1 relative to initial hand size)
    expect(g.player.hand.cards.length).toBe(initialHand + 1);

    const finishTurnAndPassTo = (nextPlayer) => {
      while (g.turns.current !== 'End') g.turns.nextPhase();
      g.turns.nextPhase(); // End -> Start
      g.turns.setActivePlayer(nextPlayer);
      g.turns.startTurn();
      g.resources.startTurn(nextPlayer);
    };

    // End player's turn -> start opponent's: buff should persist through their turn
    finishTurnAndPassTo(g.opponent);
    expect(ally.data.health).toBe(beforeHp + 2);

    // End opponent's turn -> start player's next turn: buff should now expire
    finishTurnAndPassTo(g.player);
    expect(ally.data.health).toBe(beforeHp);
  });
});

