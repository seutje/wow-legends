import { parseTrainArgs } from '../tools/train.args.mjs';
import { DEFAULT_LAMBDA_DECOR, DEFAULT_LAMBDA_L2 } from '../tools/regularization.mjs';

describe('parseTrainArgs', () => {
  test('defaults when no args provided', () => {
    const args = ['node', 'tools/train.mjs'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 100, gens: 10, reset: false, opponent: 'mcts', curriculum: null, lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('parses population, generations, and reset=true', () => {
    const args = ['node', 'tools/train.mjs', '250', '20', 'true'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 250, gens: 20, reset: true, opponent: 'mcts', curriculum: null, lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('handles reset falsy variations', () => {
    const args = ['node', 'tools/train.mjs', '150', '5', 'false'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 150, gens: 5, reset: false, opponent: 'mcts', curriculum: null, lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('parses opponent flag for saved model baseline', () => {
    const args = ['node', 'tools/train.mjs', '50', '10', 'true', 'false'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 50, gens: 10, reset: true, opponent: 'best', curriculum: null, lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('accepts curriculum flag without value and treats as gentle schedule', () => {
    const args = ['node', 'tools/train.mjs', '120', '18', 'no', 'mcts', '--curriculum'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 120, gens: 18, reset: false, opponent: 'mcts', curriculum: 'gentle', lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('parses custom curriculum spec and opponent iterations', () => {
    const args = ['node', 'tools/train.mjs', '80', '30', 'false', 'mcts@2000', '--curriculum', '0:mcts@1500,2.1:best'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 80, gens: 30, reset: false, opponent: 'mcts@2000', curriculum: '0:mcts@1500,2.1:best', lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('honors curriculum aliases provided through --schedule', () => {
    const args = ['node', 'tools/train.mjs', '60', '12', 'true', 'best', '--schedule', 'gentle'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 60, gens: 12, reset: true, opponent: 'best', curriculum: 'gentle', lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('treats trailing gentle token as curriculum when npm strips the flag', () => {
    const args = ['node', 'tools/train.mjs', '1', '1', 'gentle'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 1, gens: 1, reset: false, opponent: 'mcts', curriculum: 'gentle', lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('keeps opponent token and curriculum token when reset flag omitted', () => {
    const args = ['node', 'tools/train.mjs', '120', '18', 'best', 'gentle'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 120, gens: 18, reset: false, opponent: 'best', curriculum: 'gentle', lambdaDecor: DEFAULT_LAMBDA_DECOR, lambdaL2: DEFAULT_LAMBDA_L2 });
  });

  test('allows overriding regularization lambdas via flags', () => {
    const args = ['node', 'tools/train.mjs', '--lambda-decor', '0.2', '--lambda-l2', '0'];
    const res = parseTrainArgs(args);
    expect(res).toEqual({ pop: 100, gens: 10, reset: false, opponent: 'mcts', curriculum: null, lambdaDecor: 0.2, lambdaL2: 0 });
  });
});

