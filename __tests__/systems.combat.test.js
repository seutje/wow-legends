import Card from '../src/js/entities/card.js';
import CombatSystem from '../src/js/systems/combat.js';

describe('CombatSystem', () => {
  test('single attacker vs single blocker resolves simultaneously', () => {
    const a = new Card({ type: 'ally', name: 'A', data: { attack: 3, health: 2 } });
    const b = new Card({ type: 'ally', name: 'B', data: { attack: 2, health: 3 } });
    const c = new CombatSystem();
    c.declareAttacker(a);
    c.assignBlocker(a.id, b);
    c.resolve();
    expect(a.data.health).toBe(0); // took 2 damage
    expect(a.data.dead).toBe(true);
    expect(b.data.health).toBe(0); // took 3 damage
    expect(b.data.dead).toBe(true);
  });

  test('multi-block splits damage equally (naive)', () => {
    const a = new Card({ type: 'ally', name: 'A', data: { attack: 4, health: 4 } });
    const b1 = new Card({ type: 'ally', name: 'B1', data: { attack: 1, health: 2 } });
    const b2 = new Card({ type: 'ally', name: 'B2', data: { attack: 1, health: 2 } });
    const c = new CombatSystem();
    c.declareAttacker(a);
    c.assignBlocker(a.id, b1);
    c.assignBlocker(a.id, b2);
    c.resolve();
    expect(b1.data.health).toBe(0);
    expect(b2.data.health).toBe(0);
    // Attacker took 2 damage back
    expect(a.data.health).toBe(2);
  });
});

