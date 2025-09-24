import { jest } from '@jest/globals';
import Game from '../src/js/game.js';

describe('autoplay prompt handling', () => {
  test('target prompts resolve automatically while autoplaying', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();

    g.state.aiThinking = true;

    const enemyHero = g.opponent.hero;
    const friendlyHero = g.player.hero;

    const choice = await g.promptTarget([enemyHero, friendlyHero]);

    expect(choice).toBe(enemyHero);
  });

  test('option prompts resolve automatically while autoplaying', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();

    g.state.aiThinking = true;
    g.rng.seed(123);

    const selection = await g.promptOption(['One', 'Two', 'Three']);

    expect(selection).toBe(2);
  });

  test('player actions throttle while autoplaying', async () => {
    jest.useFakeTimers();
    try {
      const g = new Game();
      await g.setupMatch();

      g._shouldThrottleAI = true;
      g.state.aiThinking = true;

      const pending = g.throttleAIAction(g.player);
      let resolved = false;
      pending.then(() => { resolved = true; });

      await Promise.resolve();
      expect(resolved).toBe(false);

      jest.advanceTimersByTime(1000);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
