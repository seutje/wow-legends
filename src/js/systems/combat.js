import { freezeTarget } from './keywords.js';
import { isDebugLogging } from '../utils/logger.js';
import { cardsMatch, getCardInstanceId, matchesCardIdentifier } from '../utils/card.js';

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

function safeZoneTransfer(fromZone, toZone, card) {
  if (!card || !toZone) return false;
  if (fromZone && typeof fromZone.moveTo === 'function') {
    const res = fromZone.moveTo(toZone, card);
    if (res) return true;
  }
  let removed = card;
  if (fromZone && Array.isArray(fromZone.cards)) {
    const idx = fromZone.cards.findIndex(c => cardsMatch(c, card));
    if (idx !== -1) {
      [removed] = fromZone.cards.splice(idx, 1);
    }
  }
  if (typeof toZone.add === 'function') {
    toZone.add(removed);
    return true;
  }
  if (Array.isArray(toZone.cards)) {
    const exists = toZone.cards.some(c => cardsMatch(c, removed));
    if (!exists) toZone.cards.push(removed);
    return true;
  }
  return false;
}

export class CombatSystem {
  constructor(bus = null) {
    this._attacks = new Map(); // attackerKey -> { attacker, blockers: Card[] }
    this._defenderHero = null;
    this.bus = bus;
  }

  declareAttacker(attacker, defender = null) {
    // Cannot attack when frozen/stunned
    if (getStat(attacker, 'freezeTurns', 0) > 0) return false;
    // Emit an attack declaration event to allow reactive effects (e.g., secrets)
    if (this.bus) {
      try {
        this.bus.emit('attackDeclared', { attacker, defender });
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
    const key = getCardInstanceId(attacker) || attacker;
    this._attacks.set(key, { attacker, blockers: [] });
    if (this.bus) {
      try {
        this.bus.emit('attackCommitted', { attacker, defender });
      } catch (e) {
        console.error(e);
      }
    }
    return true;
  }

  assignBlocker(attackerRef, blocker) {
    let key = attackerRef;
    if (attackerRef && typeof attackerRef === 'object') {
      if (this._attacks.has(attackerRef)) {
        key = attackerRef;
      } else {
        key = getCardInstanceId(attackerRef) || attackerRef;
      }
    }
    let rec = this._attacks.get(key);
    if (!rec && typeof attackerRef === 'string') {
      for (const value of this._attacks.values()) {
        if (value?.attacker && matchesCardIdentifier(value.attacker, attackerRef)) {
          rec = value;
          break;
        }
      }
    }
    if (!rec && attackerRef && typeof attackerRef === 'object') {
      for (const value of this._attacks.values()) {
        if (cardsMatch(value?.attacker, attackerRef)) {
          rec = value;
          break;
        }
      }
    }
    if (rec) rec.blockers.push(blocker);
  }

  clear() { this._attacks.clear(); }

  setDefenderHero(hero) { this._defenderHero = hero; }

  resolve() {
    // Track individual damage events for logging
    const events = [];

    const addDmg = (target, amount, source, extra = null) => {
      if (!target || amount <= 0) return;
      const payload = extra && typeof extra === 'object'
        ? { ...extra, target, amount, source }
        : { target, amount, source };
      events.push(payload);
    };

    // For each attack group
    for (const { attacker, blockers } of this._attacks.values()) {
      const atk = getStat(attacker, 'attack', 0);
      let dealt = 0;
      if (blockers.length === 0) {
        // Unblocked: route full to hero if present
        if (this._defenderHero) {
          addDmg(this._defenderHero, atk, attacker, { incomingAttack: true });
        }
      } else {
        const per = Math.floor(atk / blockers.length) || atk; // naive equal split
        for (const b of blockers) {
          addDmg(b, per, attacker, { incomingAttack: true });
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
          addDmg(this._defenderHero, atk - dealt, attacker, { incomingAttack: true });
        }
        // Blockers strike back at attacker
        for (const b of blockers) {
          addDmg(attacker, getStat(b, 'attack', 0), b, { incomingAttack: false });
        }
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
            const moved = safeZoneTransfer(owner?.battlefield, owner?.graveyard, b);
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
            const moved = safeZoneTransfer(owner?.battlefield, owner?.graveyard, b);
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
      const prevHealth = getStat(ev.target, 'health', 0);
      ev.prevHealth = prevHealth;
      const shielded = !!(ev.target?.data?.divineShield);
      if (shielded) {
        ev.target.data.divineShield = false;
        if (ev.target?.keywords?.includes?.('Divine Shield')) {
          ev.target.keywords = ev.target.keywords.filter(k => k !== 'Divine Shield');
        }
        ev.amount = 0;
        ev.postHealth = prevHealth;
        // No damage applied; skip armor, logging, freeze, and death marking
        continue;
      }

      let rem = armorApply(ev.target, ev.amount);
      ev.amount = rem;
      const newHp = Math.max(0, prevHealth - rem);
      setStat(ev.target, 'health', newHp);
      ev.postHealth = newHp;
      if (isDebugLogging()) {
        console.log(`${ev.target.name} took ${rem} damage from ${ev.source?.name ?? 'an unknown source'}. Remaining health: ${getStat(ev.target, 'health', 0)}`);
      }
      if (ev.source?.keywords?.includes?.('Freeze') && newHp > 0) freezeTarget(ev.target, 1);
      if (newHp <= 0) setStat(ev.target, 'dead', true);

      if (!ev.isReflect && ev.amount > 0 && ev.incomingAttack) {
        const tgt = ev.target;
        const src = ev.source;
        const hasKeywordReflect = tgt?.keywords?.includes?.('Reflect');
        const tempReflectCount = tgt?.data?.tempKeywordCounts?.Reflect || 0;
        const targetIsReflectiveAlly = tgt?.type === 'ally' && (hasKeywordReflect || tempReflectCount > 0);
        const sourceIsCharacter = src && (src.type === 'ally' || src.type === 'hero');
        if (targetIsReflectiveAlly && sourceIsCharacter && src !== tgt) {
          const attackValue = getStat(tgt, 'attack', 0);
          const reflectAmount = Math.max(0, attackValue + ev.amount);
          if (reflectAmount > 0) {
            events.push({
              target: src,
              amount: reflectAmount,
              source: tgt,
              isReflect: true,
            });
          }
        }
      }
    }

    this.clear();
    return events;
  }
}

export default CombatSystem;
