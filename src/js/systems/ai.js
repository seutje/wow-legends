import CombatSystem from './combat.js';
import { evaluateGameState } from './ai-heuristics.js';
import { selectTargets } from './targeting.js';
import Card from '../entities/card.js';
import { cardsMatch, getCardInstanceId, matchesCardIdentifier } from '../utils/card.js';

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

  _entityAttackValue(card) {
    if (!card) return 0;
    if (typeof card.totalAttack === 'function') {
      try {
        return card.totalAttack();
      } catch {
        // ignore – fallback to stored stats below
      }
    }
    if (typeof card?.data?.attack === 'number') return card.data.attack;
    if (typeof card?.attack === 'number') return card.attack;
    return 0;
  }

  _entityHealthValue(card) {
    if (!card) return 0;
    if (typeof card?.data?.health === 'number') return card.data.health;
    if (typeof card?.health === 'number') return card.health;
    return 0;
  }

  _isLivingDefender(card) {
    if (!card) return false;
    if (card.type === 'equipment' || card.type === 'quest') return false;
    const data = card.data || {};
    if (data.dead) return false;
    const health = this._entityHealthValue(card);
    if (typeof health === 'number' && health <= 0) return false;
    return true;
  }

  _scoreHeroAttack(attacker, hero) {
    if (!attacker || !hero) return -Infinity;
    const attack = this._entityAttackValue(attacker);
    if (attack <= 0) return -Infinity;
    const heroHealth = this._entityHealthValue(hero);
    let score = attack * 6;
    if (heroHealth <= attack) {
      score += 120;
    } else if (heroHealth <= attack * 2) {
      score += 25;
    }
    return score;
  }

  _scoreAllyTrade(attacker, defender) {
    if (!attacker || !defender) return -Infinity;
    const attack = this._entityAttackValue(attacker);
    if (attack <= 0) return -Infinity;
    const attackerHealth = this._entityHealthValue(attacker);
    const defenderHealth = this._entityHealthValue(defender);
    const defenderAttack = this._entityAttackValue(defender);
    if (defenderHealth <= 0) return -Infinity;

    let score = defenderAttack * 8;
    if (defender?.keywords?.includes?.('Taunt')) score += 25;
    if (defender?.keywords?.includes?.('Lethal')) score += 40;

    const kills = attack >= defenderHealth;
    const dies = defenderAttack >= attackerHealth && attackerHealth > 0;

    if (kills) score += 45;
    else score -= 25;

    if (!dies) score += 20;
    else score -= 25;

    if (kills && dies) score += 5;
    if (kills && !dies) score += 15;
    if (!kills && dies) score -= 30;

    return score;
  }

  _collectDefenders(opponent) {
    const defenders = [];
    if (opponent?.hero) defenders.push(opponent.hero);
    const pool = opponent?.battlefield?.cards || [];
    for (const card of pool) {
      if (this._isLivingDefender(card)) defenders.push(card);
    }
    return defenders;
  }

  _canAttackHero(attacker, player) {
    if (!attacker) return false;
    if (attacker === player?.hero) return true;
    const data = attacker.data || {};
    if (data.summoningSick) return false;
    const hasRush = !!attacker?.keywords?.includes?.('Rush');
    const hasCharge = !!attacker?.keywords?.includes?.('Charge');
    const currentTurn = this.resources?.turns?.turn ?? null;
    const enteredTurn = typeof data.enteredTurn === 'number' ? data.enteredTurn : null;
    const justEntered = enteredTurn != null && currentTurn != null && enteredTurn === currentTurn;
    if (hasRush && justEntered && !hasCharge) return false;
    return true;
  }

  _chooseAttackTarget(attacker, player, opponent) {
    const defenders = this._collectDefenders(opponent);
    if (!defenders.length) return null;
    const legal = selectTargets(defenders);
    if (!legal.length) return null;

    const hero = opponent?.hero || null;
    const heroInPool = legal.some(t => matchesCardIdentifier(t, hero));
    const heroAllowed = heroInPool && this._canAttackHero(attacker, player);

    let bestTarget = heroAllowed && hero ? hero : null;
    let bestScore = (heroAllowed && hero) ? this._scoreHeroAttack(attacker, hero) : -Infinity;

    const enemies = legal.filter(t => !matchesCardIdentifier(t, hero));
    for (const enemy of enemies) {
      const score = this._scoreAllyTrade(attacker, enemy);
      if (!heroAllowed && !bestTarget) {
        bestTarget = enemy;
        bestScore = score;
        continue;
      }
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }

    if (!bestTarget && heroAllowed && hero) return hero;
    if (!bestTarget && enemies.length) return enemies[0];
    return bestTarget;
  }

  _simulateAction(player, opponent, { card = null, usePower = false } = {}, pool = 0) {
    const p = structuredClone(player);
    const o = structuredClone(opponent);
    let res = pool;
    let overloadNext = 0;

    if (card) {
      res -= card.cost || 0;
      const playedId = getCardInstanceId(card);
      p.hand.cards = p.hand.cards.filter((c) => {
        if (playedId) return getCardInstanceId(c) !== playedId;
        return !cardsMatch(c, card);
      });
      const played = structuredClone(card);
      if (played.type === 'ally' || played.type === 'equipment' || played.type === 'quest') {
        p.battlefield.cards.push(played);
        if (played.type === 'equipment') {
          p.hero.equipment = [played];
        }
        if (played.type === 'ally') {
          played.data = played.data || {};
          played.data.enteredTurn = this.resources?.turns?.turn ?? 0;
          if (!played.keywords?.includes('Rush')) {
            played.data.attacked = true;
          }
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
      .filter(c => (c.type !== 'equipment') && !c.data?.attacked && (this._entityAttackValue(c) > 0));
    for (const a of attackers) {
      const target = this._chooseAttackTarget(a, p, o);
      if (!target) continue;
      if (combat.declareAttacker(a, target)) {
        const targetKey = getCardInstanceId(target);
        if (targetKey && !matchesCardIdentifier(o.hero, targetKey)) {
          combat.assignBlocker(getCardInstanceId(a), target);
        }
        if (a.data) a.data.attacked = true;
      }
    }
    combat.setDefenderHero(o.hero);
    combat.resolve();

    for (const pl of [p, o]) {
      const dead = pl.battlefield.cards.filter(c => c.data?.dead);
      for (const d of dead) {
        pl.graveyard.cards.push(d);
        const deadId = getCardInstanceId(d);
        pl.battlefield.cards = pl.battlefield.cards.filter((c) => {
          if (deadId) return getCardInstanceId(c) !== deadId;
          return !cardsMatch(c, d);
        });
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
        if (best.card.type === 'ally') {
          best.card.data = best.card.data || {};
          best.card.data.enteredTurn = this.resources?.turns?.turn ?? 0;
          if (!best.card.keywords?.includes('Rush')) {
            best.card.data.attacked = true;
          }
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
      if (player?.log) player.log.push('Used hero power');
    }

    if (this.combat && opponent) {
      this.combat.clear();
      const attackers = [player.hero, ...player.battlefield.cards]
        .filter(c => (c.type !== 'equipment') && !c.data?.attacked && (this._entityAttackValue(c) > 0));
      for (const a of attackers) {
        const target = this._chooseAttackTarget(a, player, opponent);
        if (!target) continue;
        if (this.combat.declareAttacker(a, target)) {
          const targetKey = getCardInstanceId(target);
          if (targetKey && !matchesCardIdentifier(opponent.hero, targetKey)) {
            this.combat.assignBlocker(getCardInstanceId(a), target);
          }
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
