import { registerDefaults, registry, freezeTarget, enforceTaunt, isTargetable, applyLayers } from '../src/js/systems/keywords.js';
import ResourceSystem from '../src/js/systems/resources.js';
import TurnSystem from '../src/js/systems/turns.js';
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
    const owner = new Player({ name: 'Owner' });
    owner.battlefield.add(s);
    expect(isTargetable(s)).toBe(false);
    expect(isTargetable(s, { requester: owner })).toBe(true);
    expect(isTargetable(s, { allowStealthTargeting: true })).toBe(true);
  });

  test('stealth is removed when unit takes damage', () => {
    registerDefaults();
    const s = new Card({ type: 'ally', name: 'S', data: { attack: 1, health: 2 }, keywords: ['Stealth'] });
    const stealth = registry.get('Stealth');
    stealth.onDamageDealt({ target: s, amount: 1, source: null });
    expect(s.keywords).not.toContain('Stealth');
  });

  test('overload reduces next turn resources', () => {
    const turns = new TurnSystem();
    const rs = new ResourceSystem(turns);
    registerDefaults({ resourceSystem: rs });
    const p = new Player({ name: 'P' });

    turns.turn = 2;
    rs.startTurn(p);
    expect(rs.pool(p)).toBe(2);

    // Play a card with Overload 1
    registry.get('Overload').onPlay({ player: p, amount: 1 });

    // Next turn: pool should be base(3) - overload(1) = 2
    turns.turn = 3;
    rs.startTurn(p);
    expect(rs.pool(p)).toBe(2);
  });

  test('applyLayers applies in priority order', () => {
    const out = applyLayers(10, [
      { priority: 2, apply: (v)=> v*2 },
      { priority: 1, apply: (v)=> v+5 },
    ]);
    expect(out).toBe(30);
  });
});
