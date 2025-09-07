export class Encounter {
  constructor({ name = 'Encounter', onTurn } = {}) {
    this.name = name;
    this.onTurn = onTurn || (() => {});
  }
}

export class Ragnaros extends Encounter {
  constructor() {
    super({ name: 'Ragnaros', onTurn: ({ players }) => {
      // Deal 2 damage to all enemies each turn (very simple)
      for (const p of players) {
        if (!p.hero?.data) continue;
        p.hero.data.health = Math.max(0, (p.hero.data.health || 0) - 2);
      }
    }});
  }
}

export default Encounter;

