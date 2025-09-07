import { RNG } from '../utils/rng.js';

export class LootSystem {
  constructor({ seed = 1234 } = {}) {
    this.rng = new RNG(seed);
  }

  roll(table) {
    // table: [{item, weight}]
    const total = table.reduce((s, e) => s + (e.weight || 1), 0);
    let r = this.rng.random() * total;
    for (const e of table) {
      r -= (e.weight || 1);
      if (r <= 0) return e.item;
    }
    return table[table.length - 1]?.item;
  }
}

export default LootSystem;

