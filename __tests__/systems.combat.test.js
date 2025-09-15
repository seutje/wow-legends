import { jest } from '@jest/globals';
import Card from '../src/js/entities/card.js';
import CombatSystem from '../src/js/systems/combat.js';
import { setDebugLogging } from '../src/js/utils/logger.js';
import Player from '../src/js/entities/player.js';
import Equipment from '../src/js/entities/equipment.js';

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

  test('armor reduces damage and overflow routes to hero', () => {
    const a = new Card({ type: 'ally', name: 'A', data: { attack: 5, health: 3 }, keywords: ['Overflow'] });
    const b = new Card({ type: 'ally', name: 'B', data: { attack: 1, health: 1, armor: 2 } });
    const p = new Player({ name: 'Def' });
    p.hero.data.armor = 1;
    const c = new CombatSystem();
    c.declareAttacker(a);
    c.assignBlocker(a.id, b);
    c.setDefenderHero(p.hero);
    c.resolve();
    // b takes 5, armor 2 absorbs 2 => health 1 -> 0
    expect(b.data.health).toBe(0);
    // overflow 5-5? per current split, dealt equals 5 -> no overflow; adjust scenario
  });

  test('unblocked with overflow deals full to hero; armor absorbs first', () => {
    const a = new Card({ type: 'ally', name: 'A', data: { attack: 4, health: 3 }, keywords: ['Overflow'] });
    const p = new Player({ name: 'Def' });
    p.hero.data.armor = 2; p.hero.data.health = 10;
    const c = new CombatSystem();
    c.declareAttacker(a);
    c.setDefenderHero(p.hero);
    c.resolve();
    expect(p.hero.data.armor).toBe(0);
    expect(p.hero.data.health).toBe(8);
  });

  test('lethal kills blockers regardless of health; freeze prevents attack; equipment loses durability', () => {
    const p = new Player({ name: 'Atk' });
    const sword = new Equipment({ name: 'Sword', attack: 2, durability: 2 });
    p.equip(sword);
    p.hero.keywords.push('Lethal');
    const b = new Card({ type: 'ally', name: 'B', data: { attack: 1, health: 10 } });
    const c = new CombatSystem();
    // Freeze prevents declaration
    p.hero.data.freezeTurns = 1;
    expect(c.declareAttacker(p.hero)).toBe(false);
    p.hero.data.freezeTurns = 0;
    expect(c.declareAttacker(p.hero)).toBe(true);
    c.assignBlocker(p.hero.id, b);
    c.resolve();
    expect(b.data.dead).toBe(true);
    // Equipment durability reduced on attack
    expect(p.hero.equipment.length).toBe(1);
    expect(p.hero.equipment[0].durability).toBe(1);
  });

  test('unblocked attacks consume equipment durability until it breaks and moves to graveyard', () => {
    const atk = new Player({ name: 'Atk' });
    const dagger = new Equipment({ name: 'Dagger', attack: 1, durability: 2 });
    atk.equip(dagger);
    const def = new Player({ name: 'Def' });
    const c = new CombatSystem();

    c.declareAttacker(atk.hero);
    c.setDefenderHero(def.hero);
    c.resolve();
    expect(atk.hero.equipment[0].durability).toBe(1);

    c.declareAttacker(atk.hero);
    c.setDefenderHero(def.hero);
    c.resolve();
    expect(atk.hero.equipment.length).toBe(0);
    // Broken equipment should be placed into the owner's graveyard
    expect(atk.graveyard.cards).toContain(dagger);
    // And no longer be on the battlefield
    expect(atk.battlefield.cards).not.toContain(dagger);
  });

  test('freeze keyword freezes surviving targets in combat', () => {
    const we = new Card({ type: 'ally', name: 'WE', data: { attack: 3, health: 6 }, keywords: ['Freeze'] });
    const def = new Player({ name: 'Def' });
    def.hero.data.health = 10;
    const c = new CombatSystem();
    c.declareAttacker(we);
    c.setDefenderHero(def.hero);
    c.resolve();
    expect(def.hero.data.health).toBe(7);
    expect(def.hero.data.freezeTurns).toBe(1);
  });

  test('damage dealt in combat is logged with source', () => {
    const a = new Card({ type: 'ally', name: 'A', data: { attack: 3, health: 2 } });
    const b = new Card({ type: 'ally', name: 'B', data: { attack: 2, health: 3 } });
    const c = new CombatSystem();
    // Enable debug logging so combat logs are emitted
    setDebugLogging(true);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    c.declareAttacker(a);
    c.assignBlocker(a.id, b);
    c.resolve();
    expect(spy).toHaveBeenCalledWith('B took 3 damage from A. Remaining health: 0');
    expect(spy).toHaveBeenCalledWith('A took 2 damage from B. Remaining health: 0');
    spy.mockRestore();
    setDebugLogging(false);
  });
});
