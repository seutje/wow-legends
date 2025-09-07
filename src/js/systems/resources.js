import { invariant } from '../utils/assert.js';

export class ResourceSystem {
  constructor() {
    this._placedThisTurn = new WeakMap(); // player -> boolean
    this._pool = new WeakMap(); // player -> number
  }

  startTurn(player) {
    this._placedThisTurn.set(player, false);
    this._pool.set(player, this.available(player));
  }

  available(player) {
    const base = player?.resourcesZone?.size?.() ?? 0;
    return base; // modifiers can be applied later
  }

  pool(player) {
    return this._pool.get(player) ?? this.available(player);
  }

  canPlaceResource(player) {
    return !this._placedThisTurn.get(player);
  }

  placeResource(player, cardId) {
    invariant(player && player.hand && player.resourcesZone, 'Invalid player');
    if (!this.canPlaceResource(player)) return false;
    const moved = player.hand.moveTo(player.resourcesZone, cardId);
    if (moved) {
      this._placedThisTurn.set(player, true);
      // Refill pool to include the new resource
      this._pool.set(player, this.available(player));
      return true;
    }
    return false;
  }

  canPay(player, cost) {
    return this.pool(player) >= cost;
  }

  pay(player, cost) {
    const p = this.pool(player);
    if (p < cost) return false;
    this._pool.set(player, p - cost);
    return true;
  }
}

export default ResourceSystem;

