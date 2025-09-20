import { computeCorrelationMatrix, decorrelationPenalty, frobeniusOffDiagonal } from '../tools/regularization.mjs';

describe('decorrelation regularization metrics', () => {
  test('returns zero for uncorrelated activations', () => {
    const layer = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];
    const stats = decorrelationPenalty([layer]);
    expect(stats.total).toBeCloseTo(0, 10);
    expect(stats.perLayer).toHaveLength(1);
    expect(stats.perLayer[0].frobenius).toBeCloseTo(0, 10);
    expect(stats.perLayer[0].samples).toBe(layer.length);
    expect(stats.perLayer[0].width).toBe(2);
  });

  test('handles constant neurons without producing NaNs', () => {
    const layer = [
      [1, 0],
      [1, 0],
      [1, 0]
    ];
    const stats = decorrelationPenalty([layer]);
    expect(stats.total).toBeCloseTo(0, 10);
  });

  test('matches Frobenius norm for anti-correlated neurons', () => {
    const layer = [
      [1, -1],
      [-1, 1],
      [2, -2],
      [-2, 2]
    ];
    const matrix = computeCorrelationMatrix(layer);
    expect(matrix).not.toBeNull();
    const frob = frobeniusOffDiagonal(matrix);
    expect(frob).toBeCloseTo(Math.SQRT2, 6);
    const stats = decorrelationPenalty([layer]);
    expect(stats.total).toBeCloseTo(frob, 6);
  });

  test('sums contributions across layers', () => {
    const layerA = [
      [1, -1],
      [-1, 1]
    ];
    const layerB = [
      [2, -2],
      [-2, 2]
    ];
    const stats = decorrelationPenalty([layerA, layerB]);
    expect(stats.perLayer).toHaveLength(2);
    stats.perLayer.forEach((entry) => {
      expect(entry.frobenius).toBeCloseTo(Math.SQRT2, 6);
    });
    expect(stats.total).toBeCloseTo(Math.SQRT2 * 2, 6);
  });
});
