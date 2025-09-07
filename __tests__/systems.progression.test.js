import XPSystem from '../src/js/systems/progression/xp.js';
import TalentsSystem from '../src/js/systems/progression/talents.js';
import LootSystem from '../src/js/systems/loot.js';
import ReputationSystem from '../src/js/systems/reputation.js';
import Player from '../src/js/entities/player.js';
import Card from '../src/js/entities/card.js';

describe('Progression systems', () => {
  test('XP gain and levels', () => {
    const xp = new XPSystem({ thresholds: [0, 10, 25] });
    const p = new Player({ name: 'P' });
    expect(xp.level(p)).toBe(0);
    xp.gain(p, 10); expect(xp.level(p)).toBe(1);
    xp.gain(p, 15); expect(xp.level(p)).toBe(2);
  });

  test('Talents modify card cost', () => {
    const t = new TalentsSystem();
    const p = new Player({ name: 'P' });
    t.learn(p, { id: 'spell-discount', type: 'cost-reduction', cardType: 'spell', amount: 1 });
    const spell = new Card({ type: 'spell', name: 'Bolt', cost: 2 });
    const ally = new Card({ type: 'ally', name: 'Footman', cost: 2 });
    expect(t.modifyCardCost(p, spell)).toBe(1);
    expect(t.modifyCardCost(p, ally)).toBe(2);
  });

  test('Loot is deterministic with seed', () => {
    const lootA = new LootSystem({ seed: 42 });
    const lootB = new LootSystem({ seed: 42 });
    const table = [
      { item: 'common', weight: 8 },
      { item: 'rare', weight: 2 },
    ];
    const seqA = [lootA.roll(table), lootA.roll(table), lootA.roll(table)];
    const seqB = [lootB.roll(table), lootB.roll(table), lootB.roll(table)];
    expect(seqA).toEqual(seqB);
  });

  test('Reputation tracks per faction', () => {
    const rep = new ReputationSystem();
    const p = new Player({ name: 'P' });
    rep.gain(p, 'Stormwind', 5);
    expect(rep.get(p, 'Stormwind')).toBe(5);
  });
});
