import { parseTrainArgs } from '../tools/train.args.mjs';

describe('parseTrainArgs', () => {
  test('defaults when no args provided', () => {
    const args = ['node', 'tools/train.mjs'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 100, gens: 10, reset: false, opponent: 'mcts' });
  });

  test('parses population, generations, and reset=true', () => {
    const args = ['node', 'tools/train.mjs', '250', '20', 'true'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 250, gens: 20, reset: true, opponent: 'mcts' });
  });

  test('handles reset falsy variations', () => {
    const args = ['node', 'tools/train.mjs', '150', '5', 'false'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 150, gens: 5, reset: false, opponent: 'mcts' });
  });

  test('parses opponent flag for saved model baseline', () => {
    const args = ['node', 'tools/train.mjs', '50', '10', 'true', 'false'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 50, gens: 10, reset: true, opponent: 'best' });
  });
});

