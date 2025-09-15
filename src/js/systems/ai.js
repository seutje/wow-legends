import CombatSystem from './combat.js';
import { evaluateGameState } from './ai-heuristics.js';
import Card from '../entities/card.js';

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

  _applySimpleEffects(effects = [], player, opponent, pool) {
    for (const e of effects) {
      const amt = e.amount || 0;
      switch (e.type) {
        case 'heal': {
          const chars = [player.hero, ...player.battlefield.cards];
          const target = chars.find(c => {
            const cur = c.data?.health ?? c.health;
            const max = c.data?.maxHealth ?? c.maxHealth ?? cur;
            return cur < max;
          });
          if (target) {
            const max = target.data?.maxHealth ?? target.maxHealth ?? 30;
            target.data.health = Math.min(max, (target.data?.health ?? target.health) + amt);
          }
          break;
        }
        case 'damage': {
          const chars = [opponent.hero, ...opponent.battlefield.cards];
          const target = chars[0];
          if (target) {
            target.data.health = Math.max(0, (target.data?.health ?? target.health) - amt);
          }
          break;
        }
        case 'summon': {
          const { unit, count } = e;
          for (let i = 0; i < count; i++) {
            const summoned = new Card({
              name: unit.name,
              type: 'ally',
              data: { attack: unit.attack, health: unit.health },
              keywords: unit.keywords
            });
            if (!summoned.keywords?.includes('Rush')) {
              summoned.data.attacked = true;
            }
            player.battlefield.cards.push(summoned);
          }
          break;
        }
        case 'restore': {
          const avail = this.resources.available(player);
          pool = Math.min(avail, pool + amt);
          break;
        }
        default:
          break;
      }
    }
    return pool;
  }

  _simulateAction(player, opponent, { card = null, usePower = false } = {}, pool = 0) {
    const p = structuredClone(player);
    const o = structuredClone(opponent);
    let res = pool;
    let overloadNext = 0;

    if (card) {
      res -= card.cost || 0;
      p.hand.cards = p.hand.cards.filter(c => c.id !== card.id);
      const played = structuredClone(card);
      if (played.type === 'ally' || played.type === 'equipment' || played.type === 'quest') {
        p.battlefield.cards.push(played);
        if (played.type === 'equipment') {
          p.hero.equipment = [played];
        }
        if (played.type === 'ally' && !played.keywords?.includes('Rush')) {
          played.data = played.data || {};
          played.data.attacked = true;
        }
      } else {
        p.graveyard.cards.push(played);
      }
      if (played.effects) {
        // Track pending overload from played card effects
        for (const e of played.effects) {
          if (e.type === 'overload') overloadNext += (e.amount || 1);
        }
        res = this._applySimpleEffects(played.effects, p, o, res);
      }
    }

    if (usePower) {
      res -= 2;
      p.hero.powerUsed = true;
      if (p.hero.active) {
        // Track pending overload from hero power effects
        for (const e of p.hero.active) {
          if (e.type === 'overload') overloadNext += (e.amount || 1);
        }
        res = this._applySimpleEffects(p.hero.active, p, o, res);
      }
    }

    const combat = new CombatSystem();
    const attackers = [p.hero, ...(p.battlefield?.cards || [])]
      .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0));
    for (const a of attackers) {
      if (combat.declareAttacker(a)) {
        if (a.data) a.data.attacked = true;
      }
    }
    combat.setDefenderHero(o.hero);
    combat.resolve();

    for (const pl of [p, o]) {
      const dead = pl.battlefield.cards.filter(c => c.data?.dead);
      for (const d of dead) {
        pl.graveyard.cards.push(d);
        pl.battlefield.cards = pl.battlefield.cards.filter(c => c.id !== d.id);
      }
    }

    return evaluateGameState({
      player: p,
      opponent: o,
      turn: this.resources.turns.turn,
      resources: res,
      overloadNextPlayer: overloadNext,
      overloadNextOpponent: 0,
    });
  }

  takeTurn(player, opponent = null) {
    this.resources.startTurn(player);

    const drawn = player.library.draw(1);
    if (drawn[0]) player.hand.add(drawn[0]);

    const pool = this.resources.pool(player);

    const actions = [{ card: null, usePower: false }];
    const canPower = player.hero?.active?.length && !player.hero.powerUsed && pool >= 2 &&
      !this._effectsAreUseless(player.hero.active, player);
    if (canPower) actions.push({ card: null, usePower: true });

    for (const c of player.hand.cards) {
      if (!this.resources.canPay(player, c.cost || 0)) continue;
      if (this._effectsAreUseless(c.effects, player)) continue;
      actions.push({ card: c, usePower: false });
      if (canPower && pool - (c.cost || 0) >= 2) actions.push({ card: c, usePower: true });
    }

    let best = actions[0];
    let bestScore = -Infinity;
    for (const act of actions) {
      const score = this._simulateAction(player, opponent, act, pool);
      if (score > bestScore) { bestScore = score; best = act; }
    }

    if (best.card) {
      this.resources.pay(player, best.card.cost || 0);
      if (best.card.effects) this._applySimpleEffects(best.card.effects, player, opponent, pool);
      if (best.card.type === 'ally' || best.card.type === 'equipment' || best.card.type === 'quest') {
        player.hand.moveTo(player.battlefield, best.card);
        if (best.card.type === 'equipment') player.hero.equipment = [best.card];
        if (best.card.type === 'ally' && !best.card.keywords?.includes('Rush')) {
          best.card.data = best.card.data || {};
          best.card.data.attacked = true;
        }
      } else {
        player.hand.moveTo(player.graveyard, best.card);
      }
      player.cardsPlayedThisTurn += 1;
    }

    if (best.usePower) {
      this.resources.pay(player, 2);
      player.hero.powerUsed = true;
      if (player.hero.active) this._applySimpleEffects(player.hero.active, player, opponent, pool);
    }

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

      for (const p of [player, opponent]) {
        const dead = p.battlefield.cards.filter(c => c.data?.dead);
        for (const d of dead) {
          p.battlefield.moveTo(p.graveyard, d);
        }
      }
    }

    return true;
  }
}

export default BasicAI;
