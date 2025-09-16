import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import CombatSystem from '../src/js/systems/combat.js';

describe('Divine Shield', () => {
  test('absorbs one instance of spell damage before health is lost', async () => {
    const g = new Game();
    const p = g.player;
    const target = new Card({ type: 'ally', name: 'Shielded', data: { attack: 1, health: 3 }, keywords: ['Divine Shield'] });
    // Simulate entering play from hand so divine shield is initialized
    p.hand.add(target);
    await g.playFromHand(p, target.id);
    expect(target.data.divineShield).toBe(true);

    // First damage is fully absorbed
    g.promptTarget = async () => target;
    await g.effects.dealDamage({ target: 'minion', amount: 5 }, { game: g, player: p, card: null });
    expect(target.data.health).toBe(3);
    expect(target.data.divineShield).toBe(false);
    expect(target.keywords?.includes('Divine Shield')).toBe(false);

    // Next damage reduces health normally
    await g.effects.dealDamage({ target: 'minion', amount: 2 }, { game: g, player: p, card: null });
    expect(target.data.health).toBe(1);
  });

  test('combat damage is absorbed once by Divine Shield', () => {
    const attacker = new Card({ type: 'ally', name: 'Attacker', data: { attack: 3, health: 2 } });
    const defender = new Card({ type: 'ally', name: 'Defender', data: { attack: 1, health: 5, }, keywords: ['Divine Shield'] });
    // Initialize shield as if the defender entered play
    defender.data.divineShield = true;

    const c = new CombatSystem();
    c.declareAttacker(attacker);
    c.assignBlocker(attacker.id, defender);
    c.resolve();
    // First strike: shield consumed, no health loss
    expect(defender.data.divineShield).toBe(false);
    expect(defender.data.health).toBe(5);
    expect(defender.keywords?.includes('Divine Shield')).toBe(false);

    // Second strike applies damage
    c.declareAttacker(attacker);
    c.assignBlocker(attacker.id, defender);
    c.resolve();
    expect(defender.data.health).toBe(2);
  });

  test('summoned minions with Divine Shield start shielded', () => {
    const g = new Game();
    const p = g.player;
    g.effects.summonUnit(
      { type: 'summon', unit: { name: 'Token', attack: 2, health: 2, keywords: ['Divine Shield'] }, count: 1 },
      { game: g, player: p, card: null }
    );
    const token = p.battlefield.cards.find(c => c.name === 'Token');
    expect(token).toBeTruthy();
    expect(token.data.divineShield).toBe(true);
  });
});

