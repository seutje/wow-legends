import Zone from './zone.js';
import { ensureHandHookState, runHandPostAddHooks } from '../systems/post-add-hooks.js';

export class Hand extends Zone {
  constructor(name = 'hand', limit = 10) {
    super(name);
    this.limit = limit;
    ensureHandHookState(this);
  }

  add(card) {
    if (this.cards.length >= this.limit) return null;
    const added = super.add(card);
    if (added) {
      runHandPostAddHooks(this, added);
    }
    return added;
  }
}

export default Hand;

