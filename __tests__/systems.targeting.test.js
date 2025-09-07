import { isTargetLegal, selectTargets } from '../src/js/systems/targeting.js';
import Card from '../src/js/entities/card.js';

describe('Targeting', () => {
  test('legality checks by type and name', () => {
    const a = new Card({ type: 'ally', name: 'A' });
    const s = new Card({ type: 'spell', name: 'Bolt' });
    expect(isTargetLegal(a, { type: 'ally' })).toBe(true);
    expect(isTargetLegal(s, { type: 'ally' })).toBe(false); // illegal action
    const list = selectTargets([a, s], { type: 'ally' });
    expect(list).toEqual([a]);
  });
});

