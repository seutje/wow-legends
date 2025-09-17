export class QuestSystem {
  constructor(game) {
    this.game = game;
    /** @type {Map<any, { card:any, progress:number }[]>} */
    this.active = new Map();

    game.bus.on('cardPlayed', (payload) => this.onCardPlayed(payload));
    game.bus.on('allyDefeated', (payload) => this.onAllyDefeated(payload));
    game.bus.on('cardReturned', (payload) => this.onCardReturned(payload));
    game.bus.on('damageDealt', (payload) => this.onDamageDealt(payload));
    game.turns.bus.on('phase:end', ({ phase }) => {
      if (phase === 'End') {
        const player = game.turns.activePlayer;
        this.onTurnEnd({ player });
      }
    });
  }

  reset() {
    this.active.clear();
  }

  addQuest(player, card) {
    const arr = this.active.get(player) || [];
    arr.push({ card, progress: 0 });
    this.active.set(player, arr);
  }

  _complete(player, rec) {
    const arr = this.active.get(player) || [];
    const idx = arr.indexOf(rec);
    if (idx !== -1) arr.splice(idx, 1);
    // move quest card to graveyard (by instance)
    player.battlefield.moveTo(player.graveyard, rec.card);
    // notify listeners (e.g., UI) that a quest completed and was removed
    try {
      this.game?.bus?.emit?.('quest:completed', { player, card: rec.card });
    } catch {}
    if (rec.card.reward?.length) {
      this.game.effects.execute(rec.card.reward, { game: this.game, player, card: rec.card });
    }
  }

  _checkProgress(player, rec, amount = 1) {
    const req = rec.card.requirement;
    if (!req) return;
    if (req.amount) {
      rec.progress += amount;
      if (rec.progress >= req.amount) this._complete(player, rec);
    } else {
      rec.progress += 1;
      if (rec.progress >= (req.count || 1)) this._complete(player, rec);
    }
  }

  _filterCard(card, filter = {}) {
    if (!filter) return true;
    if (filter.keyword && !card?.keywords?.includes(filter.keyword)) return false;
    if (filter.type && card?.type !== filter.type) return false;
    return true;
  }

  onCardPlayed({ player, card }) {
    const quests = this.active.get(player);
    if (!quests) return;
    for (const q of quests) {
      const req = q.card.requirement;
      if (req?.event === 'cardPlayed' && this._filterCard(card, req.filter)) {
        this._checkProgress(player, q);
      }
    }
  }

  onAllyDefeated({ player, card }) {
    const quests = this.active.get(player);
    if (!quests) return;
    for (const q of quests) {
      const req = q.card.requirement;
      if (req?.event === 'allyDefeated' && this._filterCard(card, req.filter)) {
        this._checkProgress(player, q);
      }
    }
  }

  onCardReturned({ player, card }) {
    const quests = this.active.get(player);
    if (!quests) return;
    for (const q of quests) {
      const req = q.card.requirement;
      if (req?.event === 'cardReturned' && this._filterCard(card, req.filter)) {
        this._checkProgress(player, q);
      }
    }
  }

  onDamageDealt({ player, source, amount }) {
    const quests = this.active.get(player);
    if (!quests) return;
    for (const q of quests) {
      const req = q.card.requirement;
      if (req?.event === 'damageDealt' && this._filterCard(source, req.filter)) {
        this._checkProgress(player, q, amount);
      }
    }
  }

  onTurnEnd({ player }) {
    const quests = this.active.get(player);
    if (!quests) return;
    for (const q of quests) {
      const req = q.card.requirement;
      if (req?.event === 'turnEnd') {
        const count = player.battlefield.cards.filter(c => this._filterCard(c, req.filter)).length;
        if (count >= (req.count || 0)) {
          this._complete(player, q);
        }
      }
    }
  }
}

export default QuestSystem;
