/**
 * Simple event bus.
 * on(type, handler) => unsubscribe fn
 * once(type, handler)
 * emit(type, payload)
 */

export class EventBus {
  constructor() {
    this._map = new Map(); // type -> Set<fn>
  }

  on(type, handler) {
    const set = this._map.get(type) || new Set();
    set.add(handler);
    this._map.set(type, set);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      try { handler(payload); } finally { off(); }
    });
    return off;
  }

  off(type, handler) {
    const set = this._map.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._map.delete(type);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set || set.size === 0) return 0;
    // Copy to allow mutations during dispatch
    const arr = Array.from(set);
    for (const fn of arr) {
      try { fn(payload); } catch (e) { console.error(e); }
    }
    return arr.length;
  }
}

