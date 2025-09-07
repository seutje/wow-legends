import { registerDefaults, registry, freezeTarget, enforceTaunt, isTargetable, applyLayers } from '../src/js/systems/keywords.js';
import ResourceSystem from '../src/js/systems/resources.js';
import Player from '../src/js/entities/player.js';
import Card from '../src/js/entities/card.js';

describe('Keywords registry', () => {
  test('freeze and lifesteal behavior', () => {
    registerDefaults();
    const a = new Card({ type: 'ally', name: 'A', data: { attack: 2, health: 3 }, keywords: ['Freeze','Lifesteal'] });
    const b = new Card({ type: 'ally', name: 'B', data: { attack: 1, health: 5 } });
    const hooks = registry.get('Freeze');
    hooks.onDamageDealt({ source: a, target: b, amount: 2 });
    expect(b.data.freezeTurns).toBe(1);
    const life = registry.get('Lifesteal');
    life.onDamageDealt({ source: a, amount: 2 });
    expect(a.data.health).toBe(5);
  });

  test('silence removes keywords', () => {
    registerDefaults();
    const x = new Card({ type: 'ally', name: 'X', keywords: ['Taunt','Stealth'] });
    registry.get('Silence').apply({ target: x });
    expect(x.keywords.length).toBe(0);
  });

  test('taunt enforcement and stealth targeting', () => {
    const a = new Card({ type: 'ally', name: 'A' });
    const t = new Card({ type: 'ally', name: 'T', keywords: ['Taunt'] });
    expect(enforceTaunt([a,t])).toEqual([t]);
    const s = new Card({ type: 'ally', name: 'S', keywords: ['Stealth'] });
    expect(isTargetable(s)).toBe(false);
    expect(isTargetable(s, { allowStealthTargeting: true })).toBe(true);
  });

  test('overload reduces next turn resources', () => {
    const rs = new ResourceSystem();
    registerDefaults({ resourceSystem: rs });
    const p = new Player({ name: 'P' });
    // Place one resource and start turn to get pool 1
    const c = new Card({ type: 'ally', name: 'R' });
    p.hand.add(c); rs.startTurn(p); rs.placeResource(p, c.id);
    // Play a card with Overload 1
    registry.get('Overload').onPlay({ player: p, amount: 1 });
    // Next turn: pool should be base(1) - overload(1) = 0
    rs.startTurn(p);
    expect(rs.pool(p)).toBe(0);
  });

  test('applyLayers applies in priority order', () => {
    const out = applyLayers(10, [
      { priority: 2, apply: (v)=> v*2 },
      { priority: 1, apply: (v)=> v+5 },
    ]);
    expect(out).toBe(30);
  });
});

