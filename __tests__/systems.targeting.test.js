import { isTargetLegal, selectTargets } from '../src/js/systems/targeting.js';
import Card from '../src/js/entities/card.js';
import Hero from '../src/js/entities/hero.js';

describe('Targeting', () => {
  test('legality checks by type and name', () => {
    const a = new Card({ type: 'ally', name: 'A' });
    const s = new Card({ type: 'spell', name: 'Bolt' });
    expect(isTargetLegal(a, { type: 'ally' })).toBe(true);
    expect(isTargetLegal(s, { type: 'ally' })).toBe(false); // illegal action
    const list = selectTargets([a, s], { type: 'ally' });
    expect(list).toEqual([a]);
  });

  test('taunt allies must be targeted before hero or non-taunt allies', () => {
    const hero = new Hero({ name: 'Hero' });
    const taunt = new Card({ type: 'ally', name: 'T', keywords: ['Taunt'] });
    const ally = new Card({ type: 'ally', name: 'A' });
    const list = selectTargets([hero, ally, taunt]);
    expect(list).toEqual([taunt]);
  });

  test('stealth allies are untargetable unless allowed', () => {
    const stealth = new Card({ type: 'ally', name: 'S', keywords: ['Stealth'] });
    expect(selectTargets([stealth])).toEqual([]);
    expect(selectTargets([stealth], {}, { allowStealthTargeting: true })).toEqual([stealth]);
  });
});

