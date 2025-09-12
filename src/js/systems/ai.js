export class BasicAI {
  constructor({ resourceSystem, combatSystem } = {}) {
    this.resources = resourceSystem;
    this.combat = combatSystem;
  }

  _effectsAreUseless(effects = [], player) {
    if (!effects.length) return false;
    let useful = false;
    for (const e of effects) {
      switch (e.type) {
        case 'heal': {
          const chars = [player.hero, ...player.battlefield.cards];
          const injured = chars.some(c => {
            const cur = c.data?.health ?? c.health;
            const max = c.data?.maxHealth ?? c.maxHealth ?? cur;
            return cur < max;
          });
          if (injured) useful = true;
          break;
        }
        case 'restore': {
          const pool = this.resources.pool(player);
          const avail = this.resources.available(player);
          const used = avail - pool;
          if (used > 0 && (!e.requiresSpent || used >= e.requiresSpent)) useful = true;
          break;
        }
        case 'overload':
          break;
        default:
          useful = true;
      }
      if (useful) break;
    }
    return !useful;
  }

  takeTurn(player, opponent = null) {
    // Refresh available resources for the turn
    this.resources.startTurn(player);

    // Draw one card if possible
    const drawn = player.library.draw(1);
    if (drawn[0]) player.hand.add(drawn[0]);

    // Play the cheapest affordable card from hand
    const affordable = player.hand.cards
      .filter(c => this.resources.canPay(player, c.cost || 0))
      .filter(c => !this._effectsAreUseless(c.effects, player))
      .sort((a, b) => (a.cost || 0) - (b.cost || 0));
    const card = affordable[0];
    if (card) {
      this.resources.pay(player, card.cost || 0);
      if (card.type === 'ally' || card.type === 'equipment' || card.type === 'quest') {
        player.hand.moveTo(player.battlefield, card.id);
        if (card.type === 'equipment') player.hero.equipment.push(card);
        if (card.type === 'ally' && !card.keywords?.includes('Rush')) {
          card.data = card.data || {};
          card.data.attacked = true;
        }
      } else {
        player.hand.moveTo(player.graveyard, card.id);
      }
      player.cardsPlayedThisTurn += 1;
    }

    // Use hero power if available and affordable (cost 2)
    if (player.hero?.active?.length && !player.hero.powerUsed && this.resources.canPay(player, 2) &&
        !this._effectsAreUseless(player.hero.active, player)) {
      this.resources.pay(player, 2);
      player.hero.powerUsed = true;
    }

    // Declare simple attacks against the opponent hero
    if (this.combat && opponent) {
      this.combat.clear();
      const attackers = [player.hero, ...player.battlefield.cards]
        .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0));
      for (const a of attackers) {
        if (this.combat.declareAttacker(a)) {
          if (a.data) a.data.attacked = true;
        }
      }
      this.combat.setDefenderHero(opponent.hero);
      this.combat.resolve();

      // Cleanup defeated allies
      for (const p of [player, opponent]) {
        const dead = p.battlefield.cards.filter(c => c.data?.dead);
        for (const d of dead) {
          p.battlefield.moveTo(p.graveyard, d.id);
        }
      }
    }

    return true;
  }
}

export default BasicAI;

