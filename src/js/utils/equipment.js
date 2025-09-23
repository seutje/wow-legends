import { cardsMatch, matchesCardIdentifier } from './card.js';

function removeFromZone(zone, card) {
  if (!zone || !card) return null;
  if (typeof zone.remove === 'function') {
    const removed = zone.remove(card);
    if (removed) return removed;
  }
  if (Array.isArray(zone.cards)) {
    const idx = zone.cards.findIndex((c) => cardsMatch(c, card));
    if (idx !== -1) {
      return zone.cards.splice(idx, 1)[0];
    }
  }
  return null;
}

function addToZone(zone, card) {
  if (!zone || !card) return false;
  if (typeof zone.add === 'function') {
    zone.add(card);
    return true;
  }
  if (Array.isArray(zone.cards)) {
    const exists = zone.cards.some((c) => cardsMatch(c, card));
    if (!exists) zone.cards.push(card);
    return true;
  }
  return false;
}

function ensureHeroData(hero) {
  if (!hero.data) hero.data = {};
  return hero.data;
}

export function destroyEquipment(owner, equipment, { replacement = null } = {}) {
  if (!owner?.hero || !equipment) return null;
  const { hero } = owner;
  if (Array.isArray(hero.equipment)) {
    hero.equipment = hero.equipment.filter((eq) => !cardsMatch(eq, equipment));
  }

  const removed = removeFromZone(owner.battlefield, equipment);
  const card = removed || equipment;
  addToZone(owner.graveyard, card);

  const data = ensureHeroData(hero);
  const bonus = data.nextSpellDamageBonus;
  if (bonus?.sourceCardId && matchesCardIdentifier(equipment, bonus.sourceCardId)) {
    delete data.nextSpellDamageBonus;
  }

  if (Array.isArray(owner.log) && equipment?.name) {
    const replacementName = replacement?.name;
    if (replacementName) {
      owner.log.push(`${equipment.name} was destroyed when ${replacementName} was equipped.`);
    } else {
      owner.log.push(`${equipment.name} was destroyed.`);
    }
  }

  return card;
}

export function replaceEquipment(owner, newEquipment) {
  if (!owner?.hero) return newEquipment;
  const { hero } = owner;
  const current = Array.isArray(hero.equipment) ? hero.equipment : [];
  const alreadyEquipped = newEquipment ? current.some((eq) => cardsMatch(eq, newEquipment)) : false;

  if (current.length) {
    for (const eq of current) {
      if (!newEquipment || !cardsMatch(eq, newEquipment)) {
        destroyEquipment(owner, eq, { replacement: newEquipment });
      }
    }
  }

  if (newEquipment) {
    hero.equipment = [newEquipment];
    if (typeof newEquipment.armor === 'number' && newEquipment.armor !== 0 && !alreadyEquipped) {
      const data = ensureHeroData(hero);
      data.armor = (data.armor || 0) + newEquipment.armor;
    }
  } else {
    hero.equipment = [];
  }

  return newEquipment;
}

export default replaceEquipment;
