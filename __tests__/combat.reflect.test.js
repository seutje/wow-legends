import { describe, test, expect } from '@jest/globals';
import Player from '../src/js/entities/player.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import CombatSystem from '../src/js/systems/combat.js';

describe('Combat reflection from player equipment', () => {
  test('AI ally attacking player hero takes damage equal to equipment attack', () => {
    const player = new Player({ name: 'You', hero: new Hero({ name: 'Player', data: { health: 30, armor: 0 } }) });
    // Equip a weapon with 3 attack
    player.equip({ id: 'equip-weapon', name: 'Sharp Sword', attack: 3, durability: 5 });

    // Create AI ally attacker 4/5
    const attacker = new Card({ id: 'ai-ally', name: 'Raider', type: 'ally', data: { attack: 4, health: 5 } });

    const combat = new CombatSystem();
    combat.setDefenderHero(player.hero);
    expect(combat.declareAttacker(attacker)).toBe(true);
    const events = combat.resolve();

    // Player hero takes 4, attacker takes 3 from weapon reflect
    expect(player.hero.data.health).toBe(26);
    expect(attacker.data.health).toBe(2);
    // Ensure an event exists for both directions
    const toHero = events.find(ev => ev.target === player.hero && ev.source === attacker);
    const toAttacker = events.find(ev => ev.target === attacker && ev.source === player.hero);
    expect(toHero?.amount).toBe(4);
    expect(toAttacker?.amount).toBe(3);
  });

  test('AI hero attacking player hero also takes reflection damage', () => {
    const player = new Player({ name: 'You', hero: new Hero({ name: 'Player', data: { health: 30, armor: 0 } }) });
    player.equip({ id: 'equip-weapon', name: 'Sharp Sword', attack: 2, durability: 3 });

    const ai = new Player({ name: 'AI', hero: new Hero({ name: 'Boss', data: { attack: 5, health: 20, armor: 0 } }) });

    const combat = new CombatSystem();
    combat.setDefenderHero(player.hero);
    expect(combat.declareAttacker(ai.hero)).toBe(true);
    const events = combat.resolve();

    // Player hero takes 5, AI hero takes 2
    expect(player.hero.data.health).toBe(25);
    expect(ai.hero.data.health).toBe(18);
    const toHero = events.find(ev => ev.target === player.hero && ev.source === ai.hero);
    const toAttacker = events.find(ev => ev.target === ai.hero && ev.source === player.hero);
    expect(toHero?.amount).toBe(5);
    expect(toAttacker?.amount).toBe(2);
  });

  test('reflection can break equipment and move it to graveyard', () => {
    const player = new Player({ name: 'You', hero: new Hero({ name: 'Player', data: { health: 30, armor: 0 } }) });
    // Equip a weapon with 1 durability so reflection consumes it
    const weapon = player.equip({ id: 'equip-break-test', name: 'Brittle Blade', attack: 2, durability: 1 });

    const attacker = new Card({ id: 'ai-ally', name: 'Raider', type: 'ally', data: { attack: 3, health: 4 } });

    const combat = new CombatSystem();
    combat.setDefenderHero(player.hero);
    expect(combat.declareAttacker(attacker)).toBe(true);
    combat.resolve();

    // Equipment should have broken and moved to graveyard
    expect(player.hero.equipment.length).toBe(0);
    expect(player.graveyard.cards).toContain(weapon);
  });
});
