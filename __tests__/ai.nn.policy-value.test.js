import { jest } from '@jest/globals';
import { NeuralPolicyValueModel } from '../src/js/systems/ai-nn.js';
import { actionSignature } from '../src/js/systems/ai-signatures.js';

test('NeuralPolicyValueModel.evaluate scores snapshot states from MCTS clones', () => {
  const outputs = [0.2, 0.4, 0.1];
  const fakeModel = {
    forward: jest.fn(() => [outputs.shift() ?? 0]),
  };
  const model = new NeuralPolicyValueModel({ model: fakeModel, temperature: 0.5 });

  const ally = {
    id: 'ally-1',
    name: 'Shieldbearer',
    type: 'ally',
    cost: 2,
    keywords: ['Taunt'],
    data: { attack: 1, health: 4 }
  };
  const spell = {
    id: 'spell-1',
    name: 'Arcane Shot',
    type: 'spell',
    cost: 1,
    data: {},
    keywords: []
  };
  const state = {
    turn: 4,
    pool: 5,
    powerAvailable: true,
    player: {
      hero: { id: 'hero-1', name: 'Rexxar', type: 'hero', data: { health: 25, armor: 2 }, keywords: [] },
      hand: { cards: [ally, spell] },
      battlefield: { cards: [{ id: 'token-1', name: 'Wolf', type: 'ally', keywords: [], data: { attack: 2, health: 2 } }] },
      graveyard: { cards: [] },
      cardsPlayedThisTurn: 0,
      armorGainedThisTurn: 0,
    },
    opponent: {
      hero: { id: 'hero-2', name: 'Guldan', type: 'hero', data: { health: 22, armor: 0 }, keywords: [] },
      battlefield: { cards: [{ id: 'opp-ally', name: 'Imp', type: 'ally', keywords: ['Taunt'], data: { attack: 1, health: 3 } }] },
      hand: { cards: [] },
      __mctsPool: 4,
    },
  };

  const actions = [
    { card: ally, usePower: false, end: false },
    { card: null, usePower: true, end: false },
    { card: null, usePower: false, end: true },
  ];

  const result = model.evaluate(state, actions);

  expect(fakeModel.forward).toHaveBeenCalledTimes(actions.length);
  const featureLength = fakeModel.forward.mock.calls[0][0].length;
  expect(featureLength).toBeGreaterThan(30);

  const sigPlay = actionSignature(actions[0]);
  const sigPower = actionSignature(actions[1]);
  const sigEnd = actionSignature(actions[2]);

  expect(result.stateValue).toBeCloseTo(0.4, 5);
  expect(result.actionValues.get(sigPlay)).toBeCloseTo(0.2, 5);
  expect(result.actionValues.get(sigPower)).toBeCloseTo(0.4, 5);
  expect(result.actionValues.get(sigEnd)).toBeCloseTo(0.1, 5);

  const policySum = Array.from(result.policy.values()).reduce((sum, val) => sum + val, 0);
  expect(policySum).toBeCloseTo(1, 5);
  expect(result.policy.get(sigPower)).toBeGreaterThan(result.policy.get(sigPlay));
});

