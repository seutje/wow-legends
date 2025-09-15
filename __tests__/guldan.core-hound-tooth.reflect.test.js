import { describe, test, expect } from '@jest/globals';
import Player from '../src/js/entities/player.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import CombatSystem from '../src/js/systems/combat.js';

// Regression test requested: Gul'dan with Core Hound Tooth should reflect 2 damage to AI ally attacker
describe("Gul'dan + Core Hound Tooth reflection", () => {
  test("AI ally loses 2 HP when attacking Gul'dan with Core Hound Tooth equipped", () => {
    const guldan = new Hero({ id: 'hero-gul-dan-dark-conjurer', name: 'Gul\u2019dan, Dark Conjurer', data: { health: 30, armor: 0 } });
    const player = new Player({ name: 'You', hero: guldan });
    // Equip Core Hound Tooth (2 attack)
    const weapon = player.equip({ id: 'equipment-core-hound-tooth', name: 'Core Hound Tooth', attack: 2, durability: 2 });

    // Create an AI ally with 3/3
    const aiAlly = new Card({ id: 'ai-ally', name: 'AI Ally', type: 'ally', data: { attack: 3, health: 3 } });

    const combat = new CombatSystem();
    combat.setDefenderHero(player.hero);
    expect(combat.declareAttacker(aiAlly)).toBe(true);
    combat.resolve();

    // Gul'dan should take 3 damage (no armor), dropping to 27
    expect(player.hero.data.health).toBe(27);
    // AI ally should take 2 reflection damage from Core Hound Tooth, dropping from 3 to 1
    expect(aiAlly.data.health).toBe(1);
    // Weapon durability should be reduced by 1 per reflect trigger
    expect(weapon.durability).toBe(1);
  });
});
