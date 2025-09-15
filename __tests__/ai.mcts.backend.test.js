import { jest } from '@jest/globals';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { getOriginalConsole } from '../src/js/utils/logger.js';

test('MCTS AI reports its backend', async () => {
  const logSpy = jest.spyOn(getOriginalConsole(), 'log').mockImplementation(() => {});
  const ai = new MCTS_AI();
  await ai._gpuReady;
  const expected = ai._gpuKernel ? 'GPU' : 'CPU';
  const calls = logSpy.mock.calls.map(c => c[0]);
  const reported = calls.find(msg => msg.includes('MCTS AI backend'));
  expect(reported).toBeDefined();
  expect(reported).toContain(expected);
  if (typeof process !== 'undefined' && process.versions?.node && !ai._gpuKernel) {
    expect(reported).toMatch(/CPU \(GPU (init failed|unavailable):[\s\S]+\)/);
  }
  logSpy.mockRestore();
});
