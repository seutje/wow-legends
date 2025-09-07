export class XPSystem {
  constructor({ thresholds = [0, 100, 250, 450, 700] } = {}) {
    this.thresholds = thresholds;
    this._xp = new WeakMap();
  }

  xp(player) { return this._xp.get(player) || 0; }
  level(player) {
    const x = this.xp(player);
    let lvl = 0;
    for (let i = 0; i < this.thresholds.length; i++) if (x >= this.thresholds[i]) lvl = i;
    return lvl;
  }
  gain(player, amount) {
    const x = this.xp(player) + amount;
    this._xp.set(player, x);
    return this.level(player);
  }
}

export default XPSystem;

