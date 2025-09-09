function getStat(card, key, def = 0) {
  if (key === 'attack' && typeof card?.totalAttack === 'function') return card.totalAttack();
  return (card?.data && typeof card.data[key] === 'number') ? card.data[key] : def;
}

function setStat(card, key, val) {
  if (!card.data) card.data = {};
  card.data[key] = val;
}

function armorApply(card, amount) {
  const a = (card?.data?.armor ?? 0);
  const use = Math.min(a, amount);
  if (use > 0) {
    card.data.armor = a - use;
  }
  return amount - use;
}

export class CombatSystem {
  constructor() {
    this._attacks = new Map(); // attackerId -> { attacker, blockers: Card[] }
    this._defenderHero = null;
  }

  declareAttacker(attacker) {
    // Cannot attack when frozen/stunned
    if (getStat(attacker, 'freezeTurns', 0) > 0) return false;
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
          // Lethal: mark to zero health irrespective of current
          if (attacker?.keywords?.includes?.('Lethal')) {
            setStat(b, 'health', 0);
            setStat(b, 'dead', true);
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
    for (const { target, amount, source } of events) {
      let rem = armorApply(target, amount);
      const hp = getStat(target, 'health', 0);
      setStat(target, 'health', Math.max(0, hp - rem));
      console.log(`${target.name} took ${rem} damage from ${source?.name ?? 'an unknown source'}. Remaining health: ${getStat(target, 'health', 0)}`);
      if (getStat(target, 'health', 0) <= 0) setStat(target, 'dead', true);
    }

    this.clear();
  }
}

export default CombatSystem;
