import MCTS_AI from '../src/js/systems/ai-mcts.js';

test('GPU kernel selects same child as CPU', () => {
  const ai = new MCTS_AI();
  const node = {
    visits: 10,
    children: [
      { total: 0, visits: 0 },
      { total: 5, visits: 5 },
      { total: 5 + 5e-7, visits: 5 }
    ]
  };

  const gpuKernel = (totals, visits, parentVisits, c) => {
    const out = new Float32Array(totals.length);
    const logParent = Math.log(parentVisits + 1);
    for (let i = 0; i < totals.length; i++) {
      const v = visits[i];
      if (v === 0) {
        out[i] = 0;
      } else {
        const mean = totals[i] / v;
        const exploration = c * Math.sqrt(logParent / v);
        out[i] = Math.fround(mean + exploration);
      }
    }
    return out;
  };
  gpuKernel.setOutput = () => {};
  ai._gpuKernel = gpuKernel;

  const cpuChild = (() => {
    const kernel = ai._gpuKernel;
    ai._gpuKernel = null;
    const result = ai._selectChild(node);
    ai._gpuKernel = kernel;
    return result;
  })();

  const gpuChild = ai._selectChild(node);

  expect(cpuChild).toBe(node.children[0]);
  expect(gpuChild).toBe(cpuChild);
});
