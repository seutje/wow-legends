export class ReputationSystem {
  constructor() {
    this._rep = new WeakMap(); // player -> map faction->value
  }

  _map(player) { if (!this._rep.get(player)) this._rep.set(player, new Map()); return this._rep.get(player); }

  gain(player, faction, amount) {
    const m = this._map(player);
    const cur = m.get(faction) || 0;
    m.set(faction, cur + amount);
    return m.get(faction);
  }

  get(player, faction) { return this._map(player).get(faction) || 0; }
}

export default ReputationSystem;

