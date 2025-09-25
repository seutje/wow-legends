import { invariant } from '../utils/assert.js';

export class ResourceSystem {
  constructor(turns, bus = null) {
    this.turns = turns;
    this._pool = new WeakMap(); // player -> number
    this._overloadNext = new WeakMap(); // player -> number
    this._bus = bus || null;
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
    if (this._bus && cost > 0) {
      try {
        this._bus.emit('resources:spent', { player, amount: cost, resource: 'mana' });
      } catch {}
    }
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
    if (this._bus && amount > 0) {
      try {
        this._bus.emit('resources:refunded', { player, amount, resource: 'mana' });
      } catch {}
    }
  }

  pendingOverload(player) {
    return this._overloadNext.get(player) || 0;
  }

  setPendingOverload(player, amount) {
    this._overloadNext.set(player, Math.max(0, amount || 0));
  }

  addOverloadNextTurn(player, amount) {
    const cur = this._overloadNext.get(player) || 0;
    this._overloadNext.set(player, cur + amount);
  }
}

export default ResourceSystem;
