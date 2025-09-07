import Zone from './zone.js';
import { RNG } from '../utils/rng.js';

export class Deck extends Zone {
  constructor(name = 'deck') { super(name); }

  shuffle(seed = Date.now()) {
    const r = new RNG(seed);
    // Fisher–Yates in place
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = r.randomInt(0, i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(n = 1) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = this.cards.pop();
      if (!c) break;
      out.push(c);
    }
    return out;
  }
}

export default Deck;

