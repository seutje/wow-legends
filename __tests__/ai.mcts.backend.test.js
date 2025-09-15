import { jest } from '@jest/globals';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

test('MCTS AI reports its backend', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const ai = new MCTS_AI();
  await ai._gpuReady;
  const expected = ai._gpuKernel ? 'GPU' : 'CPU';
  const calls = logSpy.mock.calls.map(c => c[0]);
  const reported = calls.find(msg => msg.includes('MCTS AI backend'));
  expect(reported).toBeDefined();
  expect(reported).toContain(expected);
  logSpy.mockRestore();
});
