function getStat(card, key, def = 0) {
  return (card?.data && typeof card.data[key] === 'number') ? card.data[key] : def;
}

function setStat(card, key, val) {
  if (!card.data) card.data = {};
  card.data[key] = val;
}

export class CombatSystem {
  constructor() {
    this._attacks = new Map(); // attackerId -> { attacker, blockers: Card[] }
  }

  declareAttacker(attacker) {
    this._attacks.set(attacker.id, { attacker, blockers: [] });
  }

  assignBlocker(attackerId, blocker) {
    const rec = this._attacks.get(attackerId);
    if (rec) rec.blockers.push(blocker);
  }

  clear() { this._attacks.clear(); }

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
      if (blockers.length === 0) continue; // to hero etc., ignored for now
      const per = Math.floor(atk / blockers.length) || atk; // naive equal split
      for (const b of blockers) addDmg(b, per);
      // Blockers strike back at attacker
      for (const b of blockers) addDmg(attacker, getStat(b, 'attack', 0));
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
      if (!ref) continue;
      const hp = getStat(ref, 'health', 0);
      setStat(ref, 'health', hp - amt);
      if (getStat(ref, 'health', 0) <= 0) setStat(ref, 'dead', true);
    }

    this.clear();
  }
}

export default CombatSystem;

