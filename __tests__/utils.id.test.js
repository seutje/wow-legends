import { shortId } from '../src/js/utils/id.js';

describe('shortId', () => {
  test('generates prefixed unique ids', () => {
    const a = shortId('card');
    const b = shortId('card');
    expect(a).toMatch(/^card-/);
    expect(b).toMatch(/^card-/);
    expect(a).not.toBe(b);
  });
});

