import CardEntity from './card.js';

export class Zone {
  constructor(name = 'zone') {
    this.name = name;
    /** @type {CardEntity[]} */
    this.cards = [];
  }

  add(card) { this.cards.push(card); return card; }

  removeById(id) {
    const i = this.cards.findIndex(c => c.id === id);
    if (i !== -1) return this.cards.splice(i, 1)[0];
    return null;
  }

  moveTo(otherZone, id) {
    const c = this.removeById(id);
    if (c) otherZone.add(c);
    return c;
  }

  size() { return this.cards.length; }

  peek(n = 1) { return this.cards.slice(-n); }
}

export default Zone;

