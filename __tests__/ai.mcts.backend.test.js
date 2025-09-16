import { jest } from '@jest/globals';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

test('MCTS AI no longer reports a backend choice', () => {
  const logSpy = jest.spyOn(getOriginalConsole(), 'log').mockImplementation(() => {});
  new MCTS_AI();
  const backendLogs = logSpy.mock.calls
    .map(call => call[0])
    .filter(msg => typeof msg === 'string' && msg.includes('MCTS AI backend'));
  expect(backendLogs).toHaveLength(0);
  logSpy.mockRestore();
});
