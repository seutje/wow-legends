export class TalentsSystem {
  constructor() {
    this._talents = new WeakMap(); // player -> {id: data}
  }

  learn(player, talent) {
    const t = this._talents.get(player) || {};
    t[talent.id] = talent;
    this._talents.set(player, t);
  }

  has(player, id) {
    const t = this._talents.get(player) || {};
    return !!t[id];
  }

  modifyCardCost(player, card) {
    let cost = card.cost || 0;
    const t = this._talents.get(player) || {};
    for (const k of Object.keys(t)) {
      const talent = t[k];
      if (talent.type === 'cost-reduction' && (!talent.cardType || talent.cardType === card.type)) {
        cost = Math.max(0, cost - (talent.amount || 0));
      }
    }
    return cost;
  }
}

export default TalentsSystem;

