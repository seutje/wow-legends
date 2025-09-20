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

  test('forward can collect hidden activations when requested', () => {
    const mlp = new MLP([3, 5, 2]);
    const x = [0.2, -0.4, 0.6];
    const { output, hidden } = mlp.forward(x, { collectHidden: true });
    expect(Array.isArray(output)).toBe(true);
    expect(output).toHaveLength(2);
    expect(Array.isArray(hidden)).toBe(true);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toHaveLength(5);
    hidden[0].forEach((value) => {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    });
    const plain = mlp.forward(x);
    expect(plain).toHaveLength(2);
    plain.forEach((v, idx) => {
      expect(v).toBeCloseTo(output[idx], 10);
    });
  });
});

