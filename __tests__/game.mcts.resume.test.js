import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import { captureGameState, restoreCapturedState } from '../src/js/utils/savegame.js';

async function waitFor(predicate, timeout = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('Timed out waiting for condition'));
      setTimeout(check, 0);
    };
    check();
  });
}

test('resumePendingAITurn resumes a running MCTS turn from a save snapshot', async () => {
  let game;
  let resolveTurn;
  const initialAi = {
    takeTurn: (_player, _opponent, opts = {}) => {
      if (game?.state?.aiPending) game.state.aiPending.stage = 'running';
      return new Promise((resolve) => {
        resolveTurn = resolve;
      });
    }
  };
  game = new Game(null, { createMctsAI: async () => initialAi });
  await game.init();
  game.state.difficulty = 'medium';

  const turnPromise = game.endTurn();
  await waitFor(() => game.state?.aiPending?.stage === 'running');

  const snapshot = captureGameState(game);
  expect(snapshot?.state?.aiPending).toEqual({ type: 'mcts', stage: 'running' });

  resolveTurn();
  await turnPromise;

  let resumeOpts = null;
  let clone;
  const resumeAi = {
    takeTurn: jest.fn(async (_player, _opponent, opts = {}) => {
      resumeOpts = opts;
      if (clone.state?.aiPending) clone.state.aiPending.stage = 'running';
    })
  };
  clone = new Game(null, { createMctsAI: async () => resumeAi });
  await clone.init();
  const ok = restoreCapturedState(clone, snapshot);
  expect(ok).toBe(true);
  expect(clone.state.aiThinking).toBe(true);

  const resumed = await clone.resumePendingAITurn();
  expect(resumed).toBe(true);
  expect(resumeAi.takeTurn).toHaveBeenCalledTimes(1);
  expect(resumeOpts).toEqual({ resume: true });
  expect(clone.state.aiThinking).toBe(false);
  expect(clone.state.aiPending).toBeNull();
  expect(clone.turns.activePlayer).toBe(clone.player);
});

test('resumePendingAITurn restarts a queued MCTS turn from save data', async () => {
  const resumeAi = {
    takeTurn: jest.fn(async () => {})
  };
  const game = new Game(null, { createMctsAI: async () => resumeAi });
  await game.init();
  game.state.difficulty = 'medium';
  game.state.aiThinking = true;
  game.state.aiPending = { type: 'mcts', stage: 'queued' };
  game.turns.setActivePlayer(game.opponent);
  game.turns.current = 'Start';

  const resumed = await game.resumePendingAITurn();
  expect(resumed).toBe(true);
  expect(resumeAi.takeTurn).toHaveBeenCalledTimes(1);
  expect(resumeAi.takeTurn.mock.calls[0][2]).toEqual({ resume: false });
  expect(game.state.aiThinking).toBe(false);
  expect(game.state.aiPending).toBeNull();
  expect(game.turns.activePlayer).toBe(game.player);
});
