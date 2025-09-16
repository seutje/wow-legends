import { freezeTarget } from './keywords.js';
import { isDebugLogging } from '../utils/logger.js';

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
            // Log equipment taking a hit
            const owner = attacker?.owner;
            if (owner?.log) owner.log.push(`${eq.name} took a hit (-1 durability).`);
          }
        }
        // Move broken equipment to graveyard and remove from hero
        const owner = attacker?.owner;
        const broken = attacker.equipment.filter(e => (e?.durability ?? 1) <= 0);
            if (owner && broken.length > 0) {
              for (const b of broken) {
                // Log breaking
                if (owner?.log) owner.log.push(`${b.name} broke and was destroyed.`);
                let moved = false;
                if (owner?.battlefield && owner?.graveyard) {
              const res = owner.battlefield.moveTo(owner.graveyard, b);
                  moved = !!res;
                }
                if (!moved && owner?.graveyard?.add) {
                  owner.graveyard.add(b);
                }
              }
            }
        attacker.equipment = attacker.equipment.filter(e => (e?.durability ?? 1) > 0);
      }
    }

    // Reflective damage: if the defender hero has equipment with attack,
    // attackers that hit the hero take that much damage. Applies for both
    // player and AI heroes.
    if (this._defenderHero) {
      const eqList = Array.isArray(this._defenderHero.equipment) ? this._defenderHero.equipment : [];
      const eqAtk = eqList.reduce((s, e) => s + (e?.attack || 0), 0);
      if (eqAtk > 0) {
        for (const ev of events) {
          if (ev?.target === this._defenderHero && ev?.source) {
            // Deal reflection damage
            addDmg(ev.source, eqAtk, this._defenderHero);
            // Consume 1 durability from one attacking-capable equipment
            const eq = eqList.find(e => (e?.attack || 0) > 0 && typeof e?.durability === 'number');
            if (eq) {
              eq.durability -= 1;
              const owner = this._defenderHero?.owner;
              if (owner?.log) owner.log.push(`${eq.name} reflected damage (-1 durability).`);
            }
          }
        }
        // Remove broken equipment and send to graveyard
        const owner = this._defenderHero?.owner;
        const broken = eqList.filter(e => (e?.durability ?? 1) <= 0);
        if (owner && broken.length > 0) {
          for (const b of broken) {
            if (owner?.log) owner.log.push(`${b.name} broke and was destroyed.`);
            let moved = false;
            if (owner?.battlefield && owner?.graveyard) {
              const res = owner.battlefield.moveTo(owner.graveyard, b);
              moved = !!res;
            }
            if (!moved && owner?.graveyard?.add) {
              owner.graveyard.add(b);
            }
          }
        }
        this._defenderHero.equipment = eqList.filter(e => (e?.durability ?? 1) > 0);
      }
    }

    // Apply damage events sequentially
    for (const ev of events) {
      // Divine Shield absorbs one instance of damage (minions only)
      const shielded = !!(ev.target?.data?.divineShield);
      if (shielded) {
        ev.target.data.divineShield = false;
        if (ev.target?.keywords?.includes?.('Divine Shield')) {
          ev.target.keywords = ev.target.keywords.filter(k => k !== 'Divine Shield');
        }
        ev.amount = 0;
        // No damage applied; skip armor, logging, freeze, and death marking
        continue;
      }

      let rem = armorApply(ev.target, ev.amount);
      ev.amount = rem;
      const hp = getStat(ev.target, 'health', 0);
      const newHp = Math.max(0, hp - rem);
      setStat(ev.target, 'health', newHp);
      if (isDebugLogging()) {
        console.log(`${ev.target.name} took ${rem} damage from ${ev.source?.name ?? 'an unknown source'}. Remaining health: ${getStat(ev.target, 'health', 0)}`);
      }
      if (ev.source?.keywords?.includes?.('Freeze') && newHp > 0) freezeTarget(ev.target, 1);
      if (newHp <= 0) setStat(ev.target, 'dead', true);
    }

    this.clear();
    return events;
  }
}

export default CombatSystem;
