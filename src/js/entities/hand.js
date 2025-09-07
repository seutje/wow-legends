import Zone from './zone.js';

export class Hand extends Zone {
  constructor(name = 'hand', limit = 10) {
    super(name);
    this.limit = limit;
  }

  add(card) {
    if (this.cards.length >= this.limit) return null;
    return super.add(card);
  }
}

export default Hand;

