export class ActionStack {
  constructor() {
    this._items = []; // {priority, action, id}
    this._seq = 0;
  }

  push(action, priority = 0) {
    this._items.push({ priority, action, id: this._seq++ });
  }

  interrupt(action, priority = 1000) {
    // High-priority insert
    this.push(action, priority);
  }

  get size() { return this._items.length; }

  resolveOne() {
    if (this._items.length === 0) return null;
    // Pick highest priority; if tie, LIFO (largest id)
    let idx = 0;
    for (let i = 1; i < this._items.length; i++) {
      const a = this._items[i];
      const b = this._items[idx];
      if (a.priority > b.priority || (a.priority === b.priority && a.id > b.id)) {
        idx = i;
      }
    }
    const { action } = this._items.splice(idx, 1)[0];
    if (typeof action === 'function') return action();
    if (action && typeof action.execute === 'function') return action.execute();
    return null;
  }

  resolveAll(limit = 1000) {
    const results = [];
    for (let i = 0; i < limit && this._items.length > 0; i++) {
      results.push(this.resolveOne());
    }
    return results;
  }
}

export default ActionStack;

