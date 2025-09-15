import CardEntity from './card.js';

export class Zone {
  constructor(name = 'zone') {
    this.name = name;
    /** @type {CardEntity[]} */
    this.cards = [];
  }

  add(card) { this.cards.push(card); return card; }

  // Remove by strict reference or by id
  remove(refOrId) {
    let idx = -1;
    if (refOrId && typeof refOrId === 'object') {
      idx = this.cards.indexOf(refOrId);
      if (idx === -1 && refOrId.id) {
        idx = this.cards.findIndex(c => c.id === refOrId.id);
      }
    } else {
      idx = this.cards.findIndex(c => c.id === refOrId);
    }
    if (idx !== -1) return this.cards.splice(idx, 1)[0];
    return null;
  }

  removeById(id) {
    return this.remove(id);
  }

  moveTo(otherZone, refOrId) {
    const c = this.remove(refOrId);
    if (c) otherZone.add(c);
    return c;
  }

  size() { return this.cards.length; }

  peek(n = 1) { return this.cards.slice(-n); }
}

export default Zone;
