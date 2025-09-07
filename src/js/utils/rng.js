/**
 * Seedable RNG with deterministic sequence (Mulberry32).
 * Provides helpers: randomInt(min, maxExclusive), pick(array), shuffle(array).
 */

export class RNG {
  constructor(seed = Date.now() >>> 0) {
    this._state = seed >>> 0;
  }

  seed(n) { this._state = (n >>> 0); return this; }

  // Returns float in [0, 1)
  random() {
    // mulberry32
    let t = (this._state += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 2^32
  }

  // Integer in [min, max)
  randomInt(min, max) {
    if (max <= min) throw new Error('randomInt requires max > min');
    const r = this.random();
    return Math.floor(r * (max - min)) + min;
  }

  pick(arr) {
    if (!arr || arr.length === 0) throw new Error('pick requires non-empty array');
    return arr[this.randomInt(0, arr.length)];
  }

  // Returns new array shuffled (Fisher–Yates)
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// Default RNG instance for convenience
const defaultRng = new RNG(0x1234ABCD);

export const random = () => defaultRng.random();
export const randomInt = (min, max) => defaultRng.randomInt(min, max);
export const pick = (arr) => defaultRng.pick(arr);
export const shuffle = (arr) => defaultRng.shuffle(arr);

