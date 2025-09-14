import MLP from '../src/js/systems/nn.js';

describe('MLP serialization', () => {
  test('serialize and deserialize preserves forward output', () => {
    const mlp = new MLP([4, 8, 8, 1]);
    const x = [0.1, 0.2, 0.3, 0.4];
    const y1 = mlp.forward(x)[0];
    const obj = mlp.toJSON();
    const mlp2 = MLP.fromJSON(obj);
    const y2 = mlp2.forward(x)[0];
    expect(y2).toBeCloseTo(y1, 10);
  });
});

