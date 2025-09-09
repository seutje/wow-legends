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
    // Simultaneous damage: compute all, then apply
    const damage = new Map(); // cardId -> dmgTaken

    const addDmg = (card, amount) => {
      if (!card) return;
      damage.set(card.id, (damage.get(card.id) || 0) + amount);
    };

    // For each attack group
    for (const { attacker, blockers } of this._attacks.values()) {
      const atk = getStat(attacker, 'attack', 0);
      let dealt = 0;
      if (blockers.length === 0) {
        // Unblocked: route full to hero if present
        if (this._defenderHero) addDmg(this._defenderHero, atk);
      } else {
        const per = Math.floor(atk / blockers.length) || atk; // naive equal split
        for (const b of blockers) {
          addDmg(b, per);
          dealt += per;
          // Lethal: mark to zero health irrespective of current
          if (attacker?.keywords?.includes?.('Lethal')) {
            setStat(b, 'health', 0);
            setStat(b, 'dead', true);
          }
        }
        // Overflow to hero if flagged
        if (attacker?.keywords?.includes?.('Overflow') && this._defenderHero && dealt < atk) {
          addDmg(this._defenderHero, atk - dealt);
        }
        // Blockers strike back at attacker
        for (const b of blockers) addDmg(attacker, getStat(b, 'attack', 0));
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

    // Apply damage
    for (const [id, amt] of damage) {
      // Find the card reference in the recorded groups
      let ref = null;
      for (const { attacker, blockers } of this._attacks.values()) {
        if (attacker.id === id) { ref = attacker; break; }
        const f = blockers.find(x => x.id === id);
        if (f) { ref = f; break; }
      }
      if (!ref && this._defenderHero && this._defenderHero.id === id) ref = this._defenderHero;
      if (!ref) continue;
      let rem = amt;
      // Apply armor first
      rem = armorApply(ref, rem);
      const hp = getStat(ref, 'health', 0);
      setStat(ref, 'health', Math.max(0, hp - rem));
      if (getStat(ref, 'health', 0) <= 0) setStat(ref, 'dead', true);
    }

    this.clear();
  }
}

export default CombatSystem;
