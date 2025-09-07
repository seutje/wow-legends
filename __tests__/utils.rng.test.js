import { RNG } from '../src/js/utils/rng.js';

describe('RNG', () => {
  test('deterministic sequence for same seed', () => {
    const a = new RNG(1234);
    const b = new RNG(1234);
    const seqA = Array.from({ length: 5 }, () => a.random());
    const seqB = Array.from({ length: 5 }, () => b.random());
    expect(seqA).toEqual(seqB);
  });

  test('randomInt bounds [min,max)', () => {
    const r = new RNG(42);
    for (let i = 0; i < 100; i++) {
      const x = r.randomInt(10, 15);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThan(15);
    }
  });

  test('pick returns an element and shuffle is deterministic', () => {
    const r1 = new RNG(7);
    const r2 = new RNG(7);
    const arr = [1, 2, 3, 4, 5];
    const s1 = r1.shuffle(arr);
    const s2 = r2.shuffle(arr);
    expect(s1).toEqual(s2);
    expect(arr).toEqual([1,2,3,4,5]);
    const p = r1.pick(arr);
    expect(arr.includes(p)).toBe(true);
  });
});

