const EPS = 1e-8;

export function computeCorrelationMatrix(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const width = Array.isArray(samples[0]) ? samples[0].length : 0;
  if (!width) return Array.from({ length: 0 }, () => []);
  const n = samples.length;
  const means = new Array(width).fill(0);
  for (const vec of samples) {
    const row = Array.isArray(vec) ? vec : [];
    for (let i = 0; i < width; i++) {
      const val = Number(row[i]) || 0;
      means[i] += val;
    }
  }
  for (let i = 0; i < width; i++) {
    means[i] /= n;
  }

  const variances = new Array(width).fill(0);
  for (const vec of samples) {
    const row = Array.isArray(vec) ? vec : [];
    for (let i = 0; i < width; i++) {
      const val = Number(row[i]) || 0;
      const diff = val - means[i];
      variances[i] += diff * diff;
    }
  }
  const denomVar = n > 1 ? (n - 1) : 1;
  const std = variances.map((sum) => Math.sqrt(sum / denomVar));

  const matrix = Array.from({ length: width }, () => new Array(width).fill(0));
  const denom = n > 1 ? (n - 1) : 1;
  for (let i = 0; i < width; i++) {
    for (let j = i; j < width; j++) {
      let value = 0;
      if (std[i] >= EPS && std[j] >= EPS) {
        let sum = 0;
        for (const vec of samples) {
          const row = Array.isArray(vec) ? vec : [];
          const ai = ((Number(row[i]) || 0) - means[i]) / std[i];
          const aj = ((Number(row[j]) || 0) - means[j]) / std[j];
          sum += ai * aj;
        }
        value = sum / denom;
      }
      if (i === j) {
        matrix[i][i] = std[i] >= EPS ? 1 : 0;
      } else {
        matrix[i][j] = value;
        matrix[j][i] = value;
      }
    }
  }
  return matrix;
}

export function frobeniusOffDiagonal(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    for (let j = 0; j < row.length; j++) {
      if (i === j) continue;
      const val = Number(row[j]);
      if (!Number.isFinite(val)) continue;
      sum += val * val;
    }
  }
  return Math.sqrt(sum);
}

export function decorrelationPenalty(layers) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return { total: 0, perLayer: [] };
  }
  const perLayer = [];
  let total = 0;
  layers.forEach((samples) => {
    const matrix = computeCorrelationMatrix(samples);
    if (!matrix || matrix.length === 0) {
      perLayer.push({ frobenius: 0, samples: Array.isArray(samples) ? samples.length : 0, width: matrix ? matrix.length : 0 });
      return;
    }
    const frob = frobeniusOffDiagonal(matrix);
    perLayer.push({ frobenius: frob, samples: samples.length, width: matrix.length });
    total += frob;
  });
  return { total, perLayer };
}

export function weightL2Norm(model) {
  if (!model || !Array.isArray(model.W) || !Array.isArray(model.b)) return 0;
  let sumSq = 0;
  for (const layer of model.W) {
    if (!Array.isArray(layer)) continue;
    for (const row of layer) {
      if (!Array.isArray(row)) continue;
      for (const val of row) {
        const num = Number(val) || 0;
        sumSq += num * num;
      }
    }
  }
  for (const biases of model.b) {
    if (!Array.isArray(biases)) continue;
    for (const val of biases) {
      const num = Number(val) || 0;
      sumSq += num * num;
    }
  }
  return Math.sqrt(sumSq);
}
