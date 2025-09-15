import { jest } from '@jest/globals';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

test('MCTS AI reports CPU backend', () => {
  const logSpy = jest.spyOn(getOriginalConsole(), 'log').mockImplementation(() => {});
  const ai = new MCTS_AI();
  const calls = logSpy.mock.calls.map(c => c[0]);
  const reported = calls.find(msg => msg.includes('MCTS AI backend'));
  expect(reported).toBeDefined();
  expect(reported).toBe('MCTS AI backend: CPU');
  logSpy.mockRestore();
});
