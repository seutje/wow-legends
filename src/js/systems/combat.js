import { freezeTarget } from './keywords.js';

function getStat(card, key, def = 0) {
  if (key === 'attack' && typeof card?.totalAttack === 'function') return card.totalAttack();
  return (card?.data && typeof card.data[key] === 'number') ? card.data[key] : def;
}

function setStat(card, key, val) {
  if (!card.data) card.data = {};
  card.data[key] = val;
}

function armorApply(card, amount) {
  const current = (card?.data?.armor ?? 0);
  const a = Math.max(0, current);
  const use = Math.min(a, amount);
  if (!card.data) card.data = {};
  card.data.armor = a - use; // never negative
  return amount - use;
}

export class CombatSystem {
  constructor(bus = null) {
    this._attacks = new Map(); // attackerId -> { attacker, blockers: Card[] }
    this._defenderHero = null;
    this.bus = bus;
  }

  declareAttacker(attacker) {
    // Cannot attack when frozen/stunned
    if (getStat(attacker, 'freezeTurns', 0) > 0) return false;
    // Emit an attack declaration event to allow reactive effects (e.g., secrets)
    if (this.bus) {
      try {
        this.bus.emit('attackDeclared', { attacker });
      } catch (e) {
        // Defensive: do not block combat due to handler errors
        console.error(e);
      }
      // A handler may cancel the attack by setting a flag on the attacker
      if (attacker?.data?.attackCancelled) {
        attacker.data.attackCancelled = false; // reset flag for future turns
        return false;
      }
    }
    this._attacks.set(attacker.id, { attacker, blockers: [] });
    return true;
  }

  assignBlocker(attackerId, blocker) {
    const rec = this._attacks.get(attackerId);
    if (rec) rec.blockers.push(blocker);
  }

  clear() { this._attacks.clear(); }

  setDefenderHero(hero) { this._defenderHero = hero; }

  resolve() {
    // Track individual damage events for logging
    const events = [];

    const addDmg = (target, amount, source) => {
      if (!target || amount <= 0) return;
      events.push({ target, amount, source });
    };

    // For each attack group
    for (const { attacker, blockers } of this._attacks.values()) {
      const atk = getStat(attacker, 'attack', 0);
      let dealt = 0;
      if (blockers.length === 0) {
        // Unblocked: route full to hero if present
        if (this._defenderHero) addDmg(this._defenderHero, atk, attacker);
      } else {
        const per = Math.floor(atk / blockers.length) || atk; // naive equal split
        for (const b of blockers) {
          addDmg(b, per, attacker);
          dealt += per;
          // Lethal: mark to zero health irrespective of current, unless protected by Divine Shield
          if (attacker?.keywords?.includes?.('Lethal')) {
            const hasDivineShield = !!(b?.data?.divineShield);
            if (!hasDivineShield) {
              setStat(b, 'health', 0);
              setStat(b, 'dead', true);
            }
          }
        }
        // Overflow to hero if flagged
        if (attacker?.keywords?.includes?.('Overflow') && this._defenderHero && dealt < atk) {
          addDmg(this._defenderHero, atk - dealt, attacker);
        }
        // Blockers strike back at attacker
        for (const b of blockers) addDmg(attacker, getStat(b, 'attack', 0), b);
      }

      // Equipment durability loss on attack: if attacker has equipment list
      if (attacker?.equipment && Array.isArray(attacker.equipment)) {
        for (const eq of attacker.equipment) {
          if (typeof eq.durability === 'number') {
            eq.durability -= 1;
          }
        }
        attacker.equipment = attacker.equipment.filter(e => (e.durability ?? 1) > 0);
      }
    }

    // Apply damage events sequentially
    for (const ev of events) {
      // Divine Shield absorbs one instance of damage (minions only)
      const shielded = !!(ev.target?.data?.divineShield);
      if (shielded) {
        ev.target.data.divineShield = false;
        ev.amount = 0;
        // No damage applied; skip armor, logging, freeze, and death marking
        continue;
      }

      let rem = armorApply(ev.target, ev.amount);
      ev.amount = rem;
      const hp = getStat(ev.target, 'health', 0);
      const newHp = Math.max(0, hp - rem);
      setStat(ev.target, 'health', newHp);
      console.log(`${ev.target.name} took ${rem} damage from ${ev.source?.name ?? 'an unknown source'}. Remaining health: ${getStat(ev.target, 'health', 0)}`);
      if (ev.source?.keywords?.includes?.('Freeze') && newHp > 0) freezeTarget(ev.target, 1);
      if (newHp <= 0) setStat(ev.target, 'dead', true);
    }

    this.clear();
    return events;
  }
}

export default CombatSystem;
