import { describe, test, expect } from '@jest/globals';
import Player from '../src/js/entities/player.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import CombatSystem from '../src/js/systems/combat.js';

describe('Reflection also applies to AI hero', () => {
  test('Player ally attacking AI hero takes damage equal to AI weapon attack', () => {
    // AI hero with Core Hound Tooth (2 attack)
    const aiHero = new Hero({ id: 'hero-ai', name: 'AI Hero', data: { health: 30, armor: 0 } });
    const ai = new Player({ name: 'AI', hero: aiHero });
    ai.equip({ id: 'equipment-core-hound-tooth', name: 'Core Hound Tooth', attack: 2, durability: 2 });

    // Player ally 4/4 attacks AI hero
    const player = new Player({ name: 'You', hero: new Hero({ name: 'Player', data: { health: 30, armor: 0 } }) });
    const attacker = new Card({ id: 'p-ally', name: 'Footman', type: 'ally', data: { attack: 4, health: 4 } });

    const combat = new CombatSystem();
    combat.setDefenderHero(ai.hero);
    expect(combat.declareAttacker(attacker)).toBe(true);
    combat.resolve();

    // AI hero takes 4, attacker takes 2 reflect
    expect(ai.hero.data.health).toBe(26);
    expect(attacker.data.health).toBe(2);
  });
});

