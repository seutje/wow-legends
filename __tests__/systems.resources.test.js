import Player from '../src/js/entities/player.js';
import ResourceSystem from '../src/js/systems/resources.js';
import TurnSystem from '../src/js/systems/turns.js';

describe('ResourceSystem', () => {
  test('mana pool equals turn number, capped at 10', () => {
    const p = new Player({ name: 'R' });
    const turns = new TurnSystem();
    const r = new ResourceSystem(turns);

    // Turn 1
    turns.turn = 1;
    r.startTurn(p);
    expect(r.available(p)).toBe(1);
    expect(r.pool(p)).toBe(1);
    expect(r.canPay(p, 1)).toBe(true);
    expect(r.canPay(p, 2)).toBe(false);

    // Turn 5
    turns.turn = 5;
    r.startTurn(p);
    expect(r.available(p)).toBe(5);
    expect(r.pool(p)).toBe(5);
    expect(r.canPay(p, 5)).toBe(true);
    expect(r.canPay(p, 6)).toBe(false);

    // Turn 10
    turns.turn = 10;
    r.startTurn(p);
    expect(r.available(p)).toBe(10);
    expect(r.pool(p)).toBe(10);
    expect(r.canPay(p, 10)).toBe(true);
    expect(r.canPay(p, 11)).toBe(false);

    // Turn 15 (capped at 10)
    turns.turn = 15;
    r.startTurn(p);
    expect(r.available(p)).toBe(10);
    expect(r.pool(p)).toBe(10);
    expect(r.canPay(p, 10)).toBe(true);
    expect(r.canPay(p, 11)).toBe(false);
  });

  test('pay costs from pool', () => {
    const p = new Player({ name: 'R' });
    const turns = new TurnSystem();
    const r = new ResourceSystem(turns);

    turns.turn = 5;
    r.startTurn(p);
    expect(r.pool(p)).toBe(5);

    expect(r.pay(p, 3)).toBe(true);
    expect(r.pool(p)).toBe(2);

    expect(r.pay(p, 3)).toBe(false);
    expect(r.pool(p)).toBe(2);
  });
});