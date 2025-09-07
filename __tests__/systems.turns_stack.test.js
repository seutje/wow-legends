import TurnSystem, { Phases } from '../src/js/systems/turns.js';
import ActionStack from '../src/js/systems/stack.js';

describe('TurnSystem', () => {
  test('progresses through phases in order and loops', () => {
    const t = new TurnSystem();
    t.startTurn();
    const seen = [t.current];
    for (let i = 0; i < 6; i++) seen.push(t.nextPhase());
    // Should have cycled and included Start twice
    expect(seen[0]).toBe('Start');
    expect(seen.slice(1, 6)).toEqual(Phases.slice(1).concat('Start'));
  });
});

describe('ActionStack', () => {
  test('resolves in priority order, LIFO for ties', () => {
    const s = new ActionStack();
    const order = [];
    s.push(() => order.push('a'), 0);
    s.push(() => order.push('b'), 0);
    s.push(() => order.push('c'), 1);
    s.interrupt(() => order.push('d'), 5);
    s.resolveAll();
    expect(order).toEqual(['d', 'c', 'b', 'a']);
  });
});

