import Player from '../src/js/entities/player.js';
import Card from '../src/js/entities/card.js';
import ResourceSystem from '../src/js/systems/resources.js';

describe('ResourceSystem', () => {
  test('place one resource per turn and pay costs from pool', () => {
    const p = new Player({ name: 'R' });
    const r = new ResourceSystem();
    // Hand with two cards
    const c1 = new Card({ type: 'ally', name: 'A' });
    const c2 = new Card({ type: 'ally', name: 'B' });
    p.hand.add(c1); p.hand.add(c2);

    r.startTurn(p);
    expect(r.available(p)).toBe(0);
    expect(r.pool(p)).toBe(0);
    // Place first resource
    expect(r.placeResource(p, c1.id)).toBe(true);
    expect(p.hand.size()).toBe(1);
    expect(p.resourcesZone.size()).toBe(1);
    expect(r.available(p)).toBe(1);
    expect(r.pool(p)).toBe(1);

    // Cannot place second resource this turn
    expect(r.placeResource(p, c2.id)).toBe(false);

    // Pay a cost of 1
    expect(r.canPay(p, 1)).toBe(true);
    expect(r.pay(p, 1)).toBe(true);
    expect(r.pool(p)).toBe(0);

    // Next turn refreshes pool and allows another placement
    r.startTurn(p);
    expect(r.pool(p)).toBe(1);
    expect(r.placeResource(p, c2.id)).toBe(true);
    expect(r.available(p)).toBe(2);
    expect(r.pool(p)).toBe(2);
  });
});

