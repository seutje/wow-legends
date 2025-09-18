import Game from '../src/js/game.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import { NeuralPolicyValueModel, getActiveModel, setActiveModel } from '../src/js/systems/ai-nn.js';

beforeEach(() => {
  setActiveModel(null);
});

afterEach(() => {
  setActiveModel(null);
});

test('creating MCTS for hybrid difficulty injects neural policy model', async () => {
  const game = new Game(null);
  const ai = await game._createMctsAI('hybrid');

  expect(ai).toBeInstanceOf(MCTS_AI);
  expect(ai.iterations).toBe(10000);
  expect(ai.rolloutDepth).toBe(20);
  expect(ai.policyValueModel).toBeInstanceOf(NeuralPolicyValueModel);

  const activeModel = getActiveModel();
  expect(activeModel).toBe(ai.policyValueModel.model);
});

