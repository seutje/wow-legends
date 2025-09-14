import { invariant } from '../utils/assert.js';

export class ResourceSystem {
  constructor(turns) {
    this.turns = turns;
    this._pool = new WeakMap(); // player -> number
    this._overloadNext = new WeakMap(); // player -> number
  }

  startTurn(player) {
    const avail = this.available(player);
    const ol = this._overloadNext.get(player) || 0;
    this._pool.set(player, Math.max(0, avail - ol));
    this._overloadNext.set(player, 0);
  }

  available(player) {
    return Math.min(this.turns.turn, 10);
  }

  pool(player) {
    return this._pool.get(player) ?? this.available(player);
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

  restore(player, amount) {
    const avail = this.available(player);
    const p = this.pool(player);
    const missing = avail - p;
    if (missing <= 0) return;
    this._pool.set(player, p + Math.min(missing, amount));
  }

  // Refund paid resources without capping to available. Intended for action cancellations.
  refund(player, amount) {
    const p = this.pool(player);
    this._pool.set(player, p + amount);
  }

  addOverloadNextTurn(player, amount) {
    const cur = this._overloadNext.get(player) || 0;
    this._overloadNext.set(player, cur + amount);
  }
}

export default ResourceSystem;
