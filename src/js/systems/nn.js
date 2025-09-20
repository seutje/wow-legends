// Tiny MLP for scoring actions: Q(s,a) -> scalar
// - Hidden layer count/width driven by provided shape (ReLU activations on hidden layers)
// - Pure JS arrays for portability and serialization

export class MLP {
  constructor(sizes = [32, 64, 64, 1]) {
    if (sizes.length < 2) throw new Error('MLP needs at least input and output sizes');
    this.sizes = sizes.slice();
    // Weights: array of layers, each has weights [out][in] and biases [out]
    this.W = [];
    this.b = [];
    for (let l = 1; l < sizes.length; l++) {
      const fanIn = sizes[l - 1];
      const fanOut = sizes[l];
      const scale = Math.sqrt(2 / fanIn); // He init
      const w = new Array(fanOut);
      for (let i = 0; i < fanOut; i++) {
        w[i] = new Array(fanIn);
        for (let j = 0; j < fanIn; j++) w[i][j] = (Math.random() * 2 - 1) * scale;
      }
      const bias = new Array(fanOut).fill(0);
      this.W.push(w); this.b.push(bias);
    }
  }

  clone() {
    const m = new MLP(this.sizes);
    m.W = this.W.map(layer => layer.map(row => row.slice()));
    m.b = this.b.map(arr => arr.slice());
    return m;
  }

  mutate(sigma = 0.05, prob = 1.0) {
    for (let l = 0; l < this.W.length; l++) {
      for (let i = 0; i < this.W[l].length; i++) {
        for (let j = 0; j < this.W[l][i].length; j++) {
          if (Math.random() < prob) this.W[l][i][j] += gaussian(0, sigma);
        }
        if (Math.random() < prob) this.b[l][i] += gaussian(0, sigma);
      }
    }
  }

  static fromJSON(obj) {
    const m = new MLP(obj.sizes);
    m.W = obj.W.map(layer => layer.map(row => row.slice()));
    m.b = obj.b.map(arr => arr.slice());
    return m;
  }

  toJSON() {
    return { sizes: this.sizes.slice(), W: this.W.map(l => l.map(r => r.slice())), b: this.b.map(a => a.slice()) };
  }

  forward(x, options = undefined) {
    // x: array of length sizes[0]
    let opts = options;
    if (typeof opts === 'boolean') opts = { collectHidden: opts };
    if (opts == null) opts = {};
    const collectHidden = Boolean(opts.collectHidden || opts.returnHidden);
    const hidden = collectHidden ? [] : null;
    let a = x;
    for (let l = 0; l < this.W.length; l++) {
      const z = new Array(this.W[l].length);
      for (let i = 0; i < this.W[l].length; i++) {
        let sum = this.b[l][i];
        const row = this.W[l][i];
        // Handle mismatched inputs by padding with zeros
        const n = Math.min(row.length, a.length);
        for (let j = 0; j < n; j++) sum += row[j] * a[j];
        z[i] = sum;
      }
      if (l < this.W.length - 1) {
        a = relu(z);
        if (collectHidden) hidden.push(a.slice());
      } else {
        a = z; // last layer linear
      }
    }
    if (collectHidden) return { output: a, hidden };
    return a;
  }
}

function relu(arr) { return arr.map(v => (v > 0 ? v : 0)); }

function gaussian(mu = 0, sigma = 1) {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mu + sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export default MLP;

