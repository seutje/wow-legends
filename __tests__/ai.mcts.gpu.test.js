import MCTS_AI from '../src/js/systems/ai-mcts.js';

test('selectChild uses CPU UCB1 scoring', () => {
  const ai = new MCTS_AI();
  const node = { visits: 10, children: [
    { total: 5, visits: 5, ucb1() { return (5 / 5) + 1.4 * Math.sqrt(Math.log(11) / 5); } },
    { total: 4, visits: 4, ucb1() { return (4 / 4) + 1.4 * Math.sqrt(Math.log(11) / 4); } }
  ]};
  const expected = node.children.reduce((a, b) => (a.ucb1() > b.ucb1() ? a : b));
  const chosen = ai._selectChild(node);
  expect(chosen).toBe(expected);
});
