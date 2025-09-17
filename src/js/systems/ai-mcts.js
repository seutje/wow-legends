import CombatSystem from './combat.js';
import { selectTargets } from './targeting.js';
import { evaluateGameState } from './ai-heuristics.js';
import Card from '../entities/card.js';
import Game from '../game.js';
import Player from '../entities/player.js';
import Hero from '../entities/hero.js';

// Simple Monte Carlo Tree Search AI
// - Explores sequences of actions (play card / use hero power / end)
// - Uses a lightweight simulation (not full EffectSystem) for speed
// - Allowed to peek at opponent hand during simulation (perfect information)

class MCTSNode {
  constructor(state, parent = null, action = null) {
    this.state = state; // { player, opponent, pool, turn, powerAvailable, overloadNextPlayer, overloadNextOpponent }
    this.parent = parent;
    this.action = action; // { card, usePower, end }
    this.children = [];
    this.untried = null; // filled lazily
    this.visits = 0;
    this.total = 0;
    this.terminal = false;
  }

  ucb1(c = 1.4) {
    if (this.visits === 0) return Infinity;
    const mean = this.total / this.visits;
    const exploration = c * Math.sqrt(Math.log(this.parent.visits + 1) / this.visits);
    return mean + exploration;
  }
}

export class MCTS_AI {
  constructor({ resourceSystem, combatSystem, game = null, iterations = 500, rolloutDepth = 5, fullSim = false } = {}) {
    this.resources = resourceSystem;
    this.combat = combatSystem;
    this.game = game; // for applying chosen actions correctly
    this.iterations = iterations;
    this.rolloutDepth = rolloutDepth;
    this.fullSim = !!fullSim;
    // Prefer offloading search to a Web Worker when available (browser only)
    this._canUseWorker = (typeof window !== 'undefined') && (typeof Worker !== 'undefined');
  }

  _selectChild(node) {
    return node.children.reduce((a, b) => (a.ucb1() > b.ucb1() ? a : b));
  }

  _isCharacterInjured(entity) {
    if (!entity) return false;
    const cur = entity?.data?.health ?? entity?.health;
    if (typeof cur !== 'number') return false;
    let max = entity?.data?.maxHealth;
    if (typeof max !== 'number') max = entity?.maxHealth;
    if (typeof max !== 'number' && entity?.type === 'hero') max = 30;
    if (typeof max !== 'number') return false;
    return cur < max;
  }

  _estimateSpellDamage(player) {
    if (!player) return 0;
    let bonus = 0;
    const hero = player.hero;
    let heroBonus = 0;
    const baseFromState = typeof player.__mctsBaseSpellDamage === 'number'
      ? player.__mctsBaseSpellDamage
      : null;
    const tempFromState = typeof player.__mctsTempSpellDamage === 'number'
      ? player.__mctsTempSpellDamage
      : null;
    if (baseFromState !== null || tempFromState !== null) {
      if (baseFromState !== null) heroBonus += baseFromState;
      if (tempFromState !== null) heroBonus += tempFromState;
    } else if (hero?.data && typeof hero.data.spellDamage === 'number') {
      heroBonus += hero.data.spellDamage;
    }
    bonus += heroBonus;
    if (Array.isArray(hero?.equipment)) {
      for (const eq of hero.equipment) {
        const val = typeof eq?.spellDamage === 'number'
          ? eq.spellDamage
          : (typeof eq?.data?.spellDamage === 'number' ? eq.data.spellDamage : 0);
        bonus += val;
      }
    }
    if (Array.isArray(player?.battlefield?.cards)) {
      for (const card of player.battlefield.cards) {
        const val = typeof card?.data?.spellDamage === 'number'
          ? card.data.spellDamage
          : (typeof card?.spellDamage === 'number' ? card.spellDamage : 0);
        bonus += val;
      }
    }
    return bonus;
  }

  // Heuristic: skip actions that have no effect for common types
  _effectsAreUseless(effects = [], player, context = {}) {
    if (!effects?.length) return false;
    const rawTurn = typeof context.turn === 'number'
      ? context.turn
      : (typeof this.resources?.turns?.turn === 'number' ? this.resources.turns.turn : 0);
    const avail = Math.min(Math.max(rawTurn, 0), 10);
    let poolRemaining = avail;
    if (typeof context.pool === 'number') poolRemaining = context.pool;
    else if (typeof player?.__mctsPool === 'number') poolRemaining = player.__mctsPool;
    const spent = Math.max(0, avail - poolRemaining);
    const armor = player?.hero?.data?.armor || 0;
    const spellDamage = this._estimateSpellDamage(player);
    const card = context?.card || null;
    const cardCost = card?.cost || 0;
    const powerAvailable = !!context?.powerAvailable;

    let sawHeroSpellBuff = false;
    let heroSpellBuffUseful = false;

    for (const e of effects) {
      if (e.type === 'buff') {
        if (e.target === 'hero' && e.property === 'spellDamage') {
          const duration = e.duration || 'permanent';
          if (duration === 'thisTurn' || duration === 'endOfTurn') {
            sawHeroSpellBuff = true;
            const poolAfter = Math.max(0, poolRemaining - cardCost);
            const hasFollowupSpell = player?.hand?.cards?.some((c) => {
              if (!c) return false;
              if (card && c.id === card.id) return false;
              const cCost = c.cost || 0;
              if (cCost > poolAfter) return false;
              if (c.type === 'spell') return true;
              const usesSpellDamage = Array.isArray(c.effects) && c.effects.some((fx) => fx?.usesSpellDamage);
              const comboUses = Array.isArray(c.combo) && c.combo.some((fx) => fx?.usesSpellDamage);
              return usesSpellDamage || comboUses;
            }) || false;
            let heroPowerSpellLike = false;
            if (!hasFollowupSpell && powerAvailable && poolAfter >= 2) {
              heroPowerSpellLike = Array.isArray(player?.hero?.active)
                && player.hero.active.some((fx) => fx?.type === 'damage' && (fx.usesSpellDamage || player?.hero?.type === 'spell'));
            }
            if (hasFollowupSpell || heroPowerSpellLike) {
              heroSpellBuffUseful = true;
              return false;
            }
            continue;
          }
        }
        return false;
      }
      switch (e.type) {
        case 'heal': {
          const chars = [player?.hero, ...(player?.battlefield?.cards || [])];
          if (chars.some(c => this._isCharacterInjured(c))) return false;
          break;
        }
        case 'restore': {
          if (spent > 0 && (!e.requiresSpent || spent >= e.requiresSpent)) return false;
          break;
        }
        case 'damageArmor': {
          if ((armor + spellDamage) > 0) return false;
          break;
        }
        case 'overload':
          // Overload is a drawback; ignore when deciding usefulness
          break;
        default:
          return false;
      }
    }
    if (sawHeroSpellBuff && !heroSpellBuffUseful) return true;
    return !sawHeroSpellBuff;
  }

  _totalHeroHealth(player) {
    if (!player?.hero) return 0;
    const hero = player.hero;
    const data = hero.data || {};
    const health = typeof data.health === 'number'
      ? data.health
      : (typeof hero.health === 'number' ? hero.health : 0);
    const armor = typeof data.armor === 'number'
      ? data.armor
      : (typeof hero.armor === 'number' ? hero.armor : 0);
    return Math.max(0, health) + Math.max(0, armor);
  }

  _hasHeroAdvantage(player, opponent) {
    if (!player || !opponent) return false;
    return this._totalHeroHealth(player) > this._totalHeroHealth(opponent);
  }

  _determineOwner(entity, player, opponent) {
    if (!entity) return null;
    if (entity.id && player?.hero?.id === entity.id) return 'player';
    if (entity.id && opponent?.hero?.id === entity.id) return 'opponent';
    const playerCards = player?.battlefield?.cards || [];
    if (playerCards.some(c => c?.id === entity.id)) return 'player';
    const opponentCards = opponent?.battlefield?.cards || [];
    if (opponentCards.some(c => c?.id === entity.id)) return 'opponent';
    return null;
  }

  _getEnrageEffects(card) {
    if (!card?.effects?.length) return [];
    return card.effects.filter((fx) => fx?.type === 'buffOnSurviveDamage');
  }

  _getEnrageTracker(state, owner) {
    if (!state) return null;
    if (owner === 'opponent') {
      if (!(state.enragedOpponentThisTurn instanceof Map)) state.enragedOpponentThisTurn = new Map();
      return state.enragedOpponentThisTurn;
    }
    if (owner === 'player') {
      if (!(state.enragedPlayerThisTurn instanceof Map)) state.enragedPlayerThisTurn = new Map();
      return state.enragedPlayerThisTurn;
    }
    return null;
  }

  _recordEnrageTrigger(state, owner, card) {
    if (!card?.id) return;
    const tracker = this._getEnrageTracker(state, owner);
    if (!tracker) return;
    const prev = tracker.get(card.id) || 0;
    tracker.set(card.id, prev + 1);
  }

  _clearEnrageTracking(state, owner, cardId) {
    if (!cardId) return;
    const tracker = this._getEnrageTracker(state, owner);
    if (!tracker) return;
    tracker.delete(cardId);
  }

  _applyEnrageBuff(card, state, owner) {
    const effects = this._getEnrageEffects(card);
    if (!effects.length) return;
    card.data = card.data || {};
    for (const fx of effects) {
      if (typeof fx.attack === 'number') {
        const current = typeof card.data.attack === 'number' ? card.data.attack : 0;
        card.data.attack = current + fx.attack;
      }
      if (typeof fx.health === 'number' && fx.health !== 0) {
        const current = typeof card.data.health === 'number' ? card.data.health : 0;
        const prior = current;
        const next = current + fx.health;
        card.data.health = next;
        const baseMax = (typeof card.data.maxHealth === 'number') ? card.data.maxHealth : prior;
        card.data.maxHealth = baseMax + fx.health;
        if (fx.health < 0) {
          card.data.health = Math.max(0, Math.min(card.data.health, card.data.maxHealth));
        }
      }
    }
    this._recordEnrageTrigger(state, owner, card);
  }

  _triggerEnrageIfPresent(card, owner, state) {
    if (!card || card.type !== 'ally') return;
    if (!this._getEnrageEffects(card).length) return;
    if ((card.data?.health ?? 0) <= 0) return;
    this._applyEnrageBuff(card, state, owner);
  }

  _applyDamageToTarget(target, amount, { state = null, player = null, opponent = null } = {}) {
    if (!target || amount <= 0) return;
    const data = target.data || (target.data = {});
    const prevHealth = typeof data.health === 'number' ? data.health : (target.health ?? 0);
    if (prevHealth <= 0) return;
    const newHealth = Math.max(0, prevHealth - amount);
    data.health = newHealth;
    const owner = this._determineOwner(target, player, opponent);
    if (owner && state) {
      if (newHealth <= 0) {
        if (target.type === 'ally') data.dead = true;
        this._clearEnrageTracking(state, owner, target.id);
      } else if (newHealth < prevHealth) {
        this._triggerEnrageIfPresent(target, owner, state);
      }
    }
  }

  _collectDamageTargets(targetType, player, opponent, source = null) {
    const friendly = [player?.hero, ...(player?.battlefield?.cards || [])].filter(Boolean);
    const enemy = [opponent?.hero, ...(opponent?.battlefield?.cards || [])].filter(Boolean);
    switch (targetType) {
      case 'allCharacters':
        return [...friendly, ...enemy];
      case 'allOtherCharacters':
        return [...friendly, ...enemy].filter(t => !source || t.id !== source.id);
      case 'allies':
      case 'allFriendlies':
        return friendly;
      case 'allEnemies':
        return enemy;
      default: {
        return enemy.length ? [enemy[0]] : [];
      }
    }
  }

  _processCombatEnrage(events, state, player, opponent) {
    if (!Array.isArray(events) || !state) return;
    for (const ev of events) {
      const target = ev?.target;
      if (!target) continue;
      const owner = this._determineOwner(target, player, opponent);
      if (!owner) continue;
      const prev = typeof ev?.prevHealth === 'number'
        ? ev.prevHealth
        : (target.data?.health ?? target.health ?? 0) + (ev.amount || 0);
      const post = typeof ev?.postHealth === 'number'
        ? ev.postHealth
        : (target.data?.health ?? target.health ?? 0);
      if (post <= 0) {
        this._clearEnrageTracking(state, owner, target.id);
        continue;
      }
      if (post < prev && (ev?.amount || 0) > 0) {
        this._triggerEnrageIfPresent(target, owner, state);
      }
    }
  }

  _applySimpleEffects(effects = [], player, opponent, pool, context = {}) {
    const { source = null, state = null } = context;
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
          let total = amt;
          const usesSpellDamage = (source?.type === 'spell') || e.usesSpellDamage;
          if (usesSpellDamage) {
            total += this._estimateSpellDamage(player);
          }
          const targets = this._collectDamageTargets(e.target, player, opponent, source);
          for (const target of targets) {
            this._applyDamageToTarget(target, total, { state, player, opponent });
          }
          break;
        }
        case 'buff': {
          if (e.target === 'hero' && player?.hero) {
            const property = e.property;
            const duration = e.duration || 'permanent';
            const data = player.hero.data || (player.hero.data = {});
            if (property === 'spellDamage' && (duration === 'thisTurn' || duration === 'endOfTurn')) {
              const prevTemp = state?.tempSpellDamage || 0;
              const baseSpellDamage = typeof state?.baseHeroSpellDamage === 'number'
                ? state.baseHeroSpellDamage
                : (typeof player.__mctsBaseSpellDamage === 'number'
                  ? player.__mctsBaseSpellDamage
                  : Math.max(0, (data.spellDamage || 0) - prevTemp));
              const nextTemp = Math.max(0, prevTemp + amt);
              const clampedBase = Math.max(0, baseSpellDamage);
              data.spellDamage = Math.max(0, clampedBase + nextTemp);
              if (state) {
                state.baseHeroSpellDamage = clampedBase;
                state.tempSpellDamage = nextTemp;
              }
              player.__mctsBaseSpellDamage = clampedBase;
              player.__mctsTempSpellDamage = nextTemp;
            } else if (property) {
              const current = typeof data[property] === 'number' ? data[property] : 0;
              data[property] = current + amt;
            }
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
            if (!(summoned.keywords?.includes('Rush') || summoned.keywords?.includes('Charge'))) {
              summoned.data.attacked = true;
            }
            player.battlefield.cards.push(summoned);
            // Track entry this turn to enforce sickness in combat filter
            if (this._currentState) {
              this._currentState.enteredThisTurn.add(summoned.id);
            }
          }
          break;
        }
        case 'restore': {
          const avail = Math.min(this.resources.turns.turn, 10);
          pool = Math.min(avail, pool + amt);
          break;
        }
        default:
          break;
      }
    }
    return pool;
  }

  _cloneState(base) {
    const s = {
      player: structuredClone(base.player),
      opponent: structuredClone(base.opponent),
      pool: base.pool,
      turn: base.turn,
      powerAvailable: base.powerAvailable,
      overloadNextPlayer: base.overloadNextPlayer || 0,
      overloadNextOpponent: base.overloadNextOpponent || 0,
      enteredThisTurn: new Set(base.enteredThisTurn ? Array.from(base.enteredThisTurn) : []),
      tempSpellDamage: Math.max(0, base.tempSpellDamage || 0),
      baseHeroSpellDamage: typeof base.baseHeroSpellDamage === 'number'
        ? base.baseHeroSpellDamage
        : null,
    };
    const cloneEnrageMap = (value) => {
      if (!value) return new Map();
      if (value instanceof Map) return new Map(value);
      if (value instanceof Set) return new Map(Array.from(value, id => [id, 1]));
      if (Array.isArray(value)) return new Map(value);
      return new Map();
    };
    s.enragedOpponentThisTurn = cloneEnrageMap(base.enragedOpponentThisTurn);
    s.enragedPlayerThisTurn = cloneEnrageMap(base.enragedPlayerThisTurn);
    // track pool on the cloned player to reason about restore-spent conditions
    s.player.__mctsPool = s.pool;
    const hero = s.player?.hero;
    if (hero) {
      const heroData = hero.data || (hero.data = {});
      let baseSpellDamage = s.baseHeroSpellDamage;
      if (baseSpellDamage == null) {
        const current = typeof heroData.spellDamage === 'number' ? heroData.spellDamage : 0;
        baseSpellDamage = Math.max(0, current - s.tempSpellDamage);
      }
      baseSpellDamage = Math.max(0, baseSpellDamage);
      heroData.spellDamage = baseSpellDamage;
      s.baseHeroSpellDamage = baseSpellDamage;
      s.player.__mctsBaseSpellDamage = baseSpellDamage;
    } else {
      s.baseHeroSpellDamage = Math.max(0, s.baseHeroSpellDamage || 0);
      s.player.__mctsBaseSpellDamage = s.baseHeroSpellDamage;
    }
    s.player.__mctsTempSpellDamage = s.tempSpellDamage;
    return s;
  }

  _legalActions(state) {
    const actions = [];
    const p = state.player;
    const pool = state.pool;
    const canPower = p.hero?.active?.length && state.powerAvailable && pool >= 2
      && !this._effectsAreUseless(p.hero.active, p, { pool, turn: state.turn, powerAvailable: state.powerAvailable });
    if (canPower) actions.push({ card: null, usePower: true, end: false });
    for (const c of p.hand.cards) {
      const cost = c.cost || 0;
      if (pool < cost) continue;
      if (this._effectsAreUseless(c.effects, p, { pool, turn: state.turn, card: c, powerAvailable: state.powerAvailable })) continue;
      actions.push({ card: c, usePower: false, end: false });
      if (canPower && pool - cost >= 2) actions.push({ card: c, usePower: true, end: false });
    }
    // Always allow ending action phase (proceed to attacks)
    actions.push({ card: null, usePower: false, end: true });
    return actions;
  }

  _applyAction(state, action) {
    const s = this._cloneState(state);
    const p = s.player; const o = s.opponent;
    if (action.end) {
      return this._resolveCombatAndScore(s);
    }

    // Apply card
    if (action.card) {
      const cost = action.card.cost || 0;
      s.pool -= cost; p.__mctsPool = s.pool;
      p.hand.cards = p.hand.cards.filter(c => c.id !== action.card.id);
      const played = structuredClone(action.card);
      if (played.type === 'ally' || played.type === 'equipment' || played.type === 'quest') {
        p.battlefield.cards.push(played);
        if (played.type === 'equipment') {
          p.hero.equipment = [played];
        }
        if (played.type === 'ally' && !(played.keywords?.includes('Rush') || played.keywords?.includes('Charge'))) {
          played.data = played.data || {};
          played.data.attacked = true;
        }
        if (played.type === 'ally') s.enteredThisTurn.add(played.id);
      } else {
        p.graveyard.cards.push(played);
      }
      if (played.effects?.length) {
        // set current state for summon tracking inside effects
        this._currentState = s;
        for (const e of played.effects) { if (e.type === 'overload') s.overloadNextPlayer += (e.amount || 1); }
        s.pool = this._applySimpleEffects(played.effects, p, o, s.pool, { source: played, state: s });
        this._currentState = null;
      }
    }

    if (action.usePower) {
      s.pool -= 2; p.__mctsPool = s.pool;
      s.powerAvailable = false;
      if (p.hero.active?.length) {
        this._currentState = s;
        for (const e of p.hero.active) { if (e.type === 'overload') s.overloadNextPlayer += (e.amount || 1); }
        const source = { type: 'heroPower', hero: p.hero };
        s.pool = this._applySimpleEffects(p.hero.active, p, o, s.pool, { source, state: s });
        this._currentState = null;
      }
    }

    return { terminal: false, state: s };
  }

  _resolveCombatAndScore(state) {
    // Simulate a simple combat: attack with all ready attackers at opponent hero
    const p = state.player; const o = state.opponent;
    const combat = new CombatSystem();
    const attackers = [p.hero, ...(p.battlefield?.cards || [])]
      .filter(c => {
        if (c.type === 'equipment') return false;
        const atk = (typeof c.totalAttack === 'function' ? c.totalAttack() : (c.data?.attack || 0));
        if (atk <= 0) return false;
        if (c === p.hero) return !c.data?.attacked; // hero can attack if not already
        // Allies: enforce summoning sickness guard regardless of flags
        const entered = state.enteredThisTurn?.has?.(c.id);
        const rush = !!c.keywords?.includes?.('Rush');
        const charge = !!c.keywords?.includes?.('Charge');
        if (entered && !(rush || charge)) return false;
        return !c.data?.attacked;
      });
    for (const a of attackers) {
      // Assign a blocker obeying Taunt (similar to real flow)
      const defenders = [
        o.hero,
        ...o.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')
      ];
      const legal = selectTargets(defenders);
      const preferFace = this._hasHeroAdvantage(p, o);
      const heroLegal = legal.some(t => t.id === o.hero.id);
      let block = null;
      if (!preferFace || !heroLegal) {
        if (legal.length === 1) {
          const only = legal[0];
          if (only.id !== o.hero.id) block = only;
        } else if (legal.length > 1) {
          const choices = legal.filter(t => t.id !== o.hero.id);
          block = choices[0] || null;
        }
      }
      // Rush restriction on entry: if no non-hero target, skip attack
      const entered = state.enteredThisTurn?.has?.(a.id);
      const rush = !!a.keywords?.includes?.('Rush');
      if (entered && rush && !block) continue;
      const target = (preferFace && heroLegal) ? o.hero : (block || o.hero);
      if (!combat.declareAttacker(a, target)) continue;
      if (a.data) a.data.attacked = true;
      if (block && target !== o.hero) combat.assignBlocker(a.id, block);
    }
    combat.setDefenderHero(o.hero);
    const events = combat.resolve();
    this._processCombatEnrage(events, state, p, o);

    for (const pl of [p, o]) {
      const dead = pl.battlefield.cards.filter(c => c.data?.dead);
      for (const d of dead) {
        pl.graveyard.cards.push(d);
        pl.battlefield.cards = pl.battlefield.cards.filter(c => c.id !== d.id);
      }
    }

    const score = evaluateGameState({
      player: p,
      opponent: o,
      turn: state.turn,
      resources: state.pool,
      overloadNextPlayer: state.overloadNextPlayer,
      overloadNextOpponent: state.overloadNextOpponent,
      enragedOpponentThisTurn: state.enragedOpponentThisTurn,
    });
    return { terminal: true, value: score };
  }

  _randomPlayout(state) {
    // Perform random actions up to rolloutDepth or until ending, then score after combat
    let s = this._cloneState(state);
    for (let d = 0; d < this.rolloutDepth; d++) {
      const actions = this._legalActions(s);
      if (!actions.length) break;
      // Bias slightly against immediate end unless there are no other actions
      const nonEnd = actions.filter(a => !a.end);
      const pickFrom = nonEnd.length ? nonEnd : actions;
      const a = pickFrom[Math.floor(Math.random() * pickFrom.length)];
      const res = this._applyAction(s, a);
      if (res.terminal) return res.value;
      s = res.state;
    }
    return this._resolveCombatAndScore(s).value;
  }

  _bestChild(node) {
    let best = null; let bestVal = -Infinity;
    for (const ch of node.children) {
      const val = ch.visits === 0 ? -Infinity : (ch.total / ch.visits);
      if (val > bestVal) { bestVal = val; best = ch; }
    }
    return best;
  }

  // ---------- Full-fidelity simulation using cloned Game ----------

  _deepCloneEffects(effects) {
    return effects ? JSON.parse(JSON.stringify(effects)) : [];
  }

  _cloneCardEntity(c) {
    const copy = new Card({
      id: c.id,
      type: c.type,
      name: c.name,
      cost: c.cost,
      keywords: Array.isArray(c.keywords) ? Array.from(c.keywords) : [],
      data: c.data ? { ...c.data } : {},
      text: c.text,
      effects: this._deepCloneEffects(c.effects),
      combo: this._deepCloneEffects(c.combo),
      requirement: c.requirement || null,
      reward: this._deepCloneEffects(c.reward || []),
      summonedBy: c.summonedBy || null,
    });
    if (c.deathrattle) copy.deathrattle = this._deepCloneEffects(c.deathrattle);
    return copy;
  }

  _cloneHero(h) {
    const hero = new Hero({
      id: h.id,
      name: h.name,
      data: h.data ? { ...h.data } : {},
      keywords: Array.isArray(h.keywords) ? Array.from(h.keywords) : [],
      text: h.text,
      effects: this._deepCloneEffects(h.active || h.effects || []),
      active: this._deepCloneEffects(h.active || []),
      passive: this._deepCloneEffects(h.passive || []),
    });
    hero.powerUsed = !!h.powerUsed;
    // Equipment can be either Equipment entities or equipment-like cards; copy shallowly
    hero.equipment = Array.isArray(h.equipment) ? h.equipment.map(eq => ({
      id: eq.id,
      name: eq.name,
      attack: eq.attack || 0,
      armor: eq.armor || 0,
      durability: eq.durability || 0,
      type: eq.type,
    })) : [];
    return hero;
  }

  _clonePlayer(p) {
    const player = new Player({ name: p.name, hero: this._cloneHero(p.hero) });
    player.cardsPlayedThisTurn = p.cardsPlayedThisTurn || 0;
    player.armorGainedThisTurn = p.armorGainedThisTurn || 0;
    // Zones: preserve order
    player.library.cards = p.library.cards.map(c => this._cloneCardEntity(c));
    player.hand.cards = p.hand.cards.map(c => this._cloneCardEntity(c));
    player.graveyard.cards = p.graveyard.cards.map(c => this._cloneCardEntity(c));
    player.battlefield.cards = p.battlefield.cards.map(c => this._cloneCardEntity(c));
    player.removed.cards = p.removed.cards.map(c => this._cloneCardEntity(c));
    return player;
  }

  _buildSimFrom(game, me, opp) {
    const sim = new Game(null);
    // Clone players (do not call setupMatch)
    sim.player = this._clonePlayer(me);
    sim.opponent = this._clonePlayer(opp);
    // Sync turns and activePlayer
    sim.turns.turn = game?.turns?.turn || 1;
    sim.turns.setActivePlayer(sim.player);
    // Sync resources pool to current values
    const myPool = this.resources?.pool ? this.resources.pool(me) : Math.min(sim.turns.turn, 10);
    const opPool = this.resources?.pool ? this.resources.pool(opp) : Math.min(sim.turns.turn, 10);
    // startTurn initializes internal pool maps; then overwrite to exact values
    sim.resources.startTurn(sim.player);
    sim.resources.startTurn(sim.opponent);
    sim.resources._pool.set(sim.player, myPool);
    sim.resources._pool.set(sim.opponent, opPool);
    const originResources = game?.resources || this.resources;
    const myOverload = originResources?.pendingOverload?.(me) ?? originResources?._overloadNext?.get?.(me) ?? 0;
    const oppOverload = originResources?.pendingOverload?.(opp) ?? originResources?._overloadNext?.get?.(opp) ?? 0;
    if (typeof sim.resources.setPendingOverload === 'function') {
      sim.resources.setPendingOverload(sim.player, myOverload);
      sim.resources.setPendingOverload(sim.opponent, oppOverload);
    } else {
      sim.resources._overloadNext?.set?.(sim.player, myOverload);
      sim.resources._overloadNext?.set?.(sim.opponent, oppOverload);
    }
    return sim;
  }

  _legalActionsSim(sim, me) {
    const actions = [];
    const pool = sim.resources.pool(me);
    const canPower = me.hero?.active?.length && !me.hero.powerUsed && pool >= 2;
    if (canPower) actions.push({ card: null, usePower: true, end: false });
    for (const c of me.hand.cards) {
      const cost = c.cost || 0;
      if (pool >= cost) actions.push({ card: c, usePower: false, end: false });
    }
    actions.push({ card: null, usePower: false, end: true });
    return actions;
  }

  _cloneSim(sim) {
    // Clone from current sim to a fresh sim snapshot
    return this._buildSimFrom(sim, sim.player, sim.opponent);
  }

  async _applyActionSim(sim, action) {
    const s = this._cloneSim(sim);
    const me = s.player; const opp = s.opponent;
    if (action.end) {
      return await this._resolveCombatAndScoreSim(s);
    }
    if (action.card) {
      const ok = await s.playFromHand(me, action.card.id);
      if (!ok) return { terminal: true, value: -Infinity }; // illegal in sim => punish
    }
    if (action.usePower) {
      const ok = await s.useHeroPower(me);
      if (!ok) return { terminal: true, value: -Infinity };
    }
    return { terminal: false, state: s };
  }

  async _resolveCombatAndScoreSim(sim) {
    const me = sim.player; const opp = sim.opponent;
    // Attack with all ready attackers; let Game decide targets
    const attackers = [me.hero, ...me.battlefield.cards]
      .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0) && !c.data?.summoningSick);
    for (const a of attackers) {
      // Respect Windfury (two attacks)
      const maxAttacks = a?.keywords?.includes?.('Windfury') ? 2 : 1;
      for (let i = (a.data?.attacksUsed || 0); i < maxAttacks; i++) {
        const ok = await sim.attack(me, a.id);
        if (!ok) break;
      }
    }
    const value = evaluateGameState({
      player: me,
      opponent: opp,
      turn: sim.turns.turn,
      resources: sim.resources.pool(me),
      overloadNextPlayer: 0,
      overloadNextOpponent: 0,
    });
    return { terminal: true, value };
  }

  async _randomPlayoutSim(sim) {
    let s = this._cloneSim(sim);
    for (let d = 0; d < this.rolloutDepth; d++) {
      const actions = this._legalActionsSim(s, s.player);
      if (!actions.length) break;
      const nonEnd = actions.filter(a => !a.end);
      const pickFrom = nonEnd.length ? nonEnd : actions;
      const a = pickFrom[Math.floor(Math.random() * pickFrom.length)];
      const res = await this._applyActionSim(s, a);
      if (res.terminal) return res.value;
      s = res.state;
    }
    const res = await this._resolveCombatAndScoreSim(s);
    return res.value;
  }

  async _searchFullSimAsync(rootGame) {
    // Root is a sim snapshot built from the external game state
    const rootSim = rootGame;
    const root = new MCTSNode(rootSim);
    for (let i = 0; i < this.iterations; i++) {
      let node = root;
      // Selection
      while (!node.terminal && (node.untried === null ? false : node.untried.length === 0 && node.children.length)) {
        node = this._selectChild(node);
      }
      // Expansion
      if (node.terminal) {
        const value = node.visits > 0 ? (node.total / node.visits) : 0;
        let n = node;
        while (n) { n.visits++; n.total += value; n = n.parent; }
        continue;
      }
      if (node.untried === null) node.untried = this._legalActionsSim(node.state, node.state.player);
      if (node.untried.length) {
        const idx = Math.floor(Math.random() * node.untried.length);
        const action = node.untried.splice(idx, 1)[0];
        const res = await this._applyActionSim(node.state, action);
        if (res.terminal) {
          const value = res.value;
          const child = new MCTSNode(null, node, action);
          child.visits = 1;
          child.total = value;
          child.terminal = true;
          child.state = null;
          child.untried = [];
          child.children = [];
          node.children.push(child);
          let n = node; while (n) { n.visits++; n.total += value; n = n.parent; }
          continue;
        } else {
          const child = new MCTSNode(res.state, node, action);
          node.children.push(child);
          node = child;
        }
      }
      // Rollout
      const value = await this._randomPlayoutSim(node.state);
      // Backpropagation
      while (node) { node.visits++; node.total += value; node = node.parent; }
    }
    const best = this._bestChild(root);
    return best?.action || { end: true };
  }

  _search(rootState) {
    const root = new MCTSNode(this._cloneState(rootState));
    for (let i = 0; i < this.iterations; i++) {
      // Progress events for UI overlays (best-effort; in main thread these won't paint until yielding)
      if (i === 0 || (i % 100) === 0) {
        const progress = Math.min(1, i / Math.max(1, this.iterations));
        try { this.game?.bus?.emit?.('ai:progress', { progress }); } catch {}
      }
      // Selection
      let node = root;
      while (!node.terminal && (node.untried === null ? false : node.untried.length === 0 && node.children.length)) {
        node = this._selectChild(node);
      }
      // Expansion
      if (node.terminal) {
        const value = node.visits > 0 ? (node.total / node.visits) : 0;
        let n = node;
        while (n) { n.visits++; n.total += value; n = n.parent; }
        continue;
      }
      if (node.untried === null) node.untried = this._legalActions(node.state);
      if (node.untried.length) {
        const idx = Math.floor(Math.random() * node.untried.length);
        const action = node.untried.splice(idx, 1)[0];
        const res = this._applyAction(node.state, action);
        if (res.terminal) {
          // Rollout is trivial: already terminal
          const value = res.value;
          const child = new MCTSNode(null, node, action);
          child.visits = 1;
          child.total = value;
          child.terminal = true;
          child.state = null;
          child.untried = [];
          child.children = [];
          node.children.push(child);
          // Backprop
          let n = node;
          while (n) { n.visits++; n.total += value; n = n.parent; }
          continue;
        } else {
          const child = new MCTSNode(res.state, node, action);
          node.children.push(child);
          node = child;
        }
      }
      // Rollout
      const value = this._randomPlayout(node.state);
      // Backpropagation
      while (node) { node.visits++; node.total += value; node = node.parent; }
    }
    // Choose child with best average value
    const best = this._bestChild(root);
    try { this.game?.bus?.emit?.('ai:progress', { progress: 1 }); } catch {}
    return best?.action || { end: true };
  }

  // Offload search to a web worker when running in browser on hard difficulty.
  async _searchAsync(rootState) {
    const useWorker = this._canUseWorker && this.game?.state?.difficulty === 'hard';
    if (!useWorker) {
      // Perform incremental search on the main thread, yielding periodically for UI updates
      const root = new MCTSNode(this._cloneState(rootState));
      const iterations = this.iterations;
      const chunk = 200;
      const doOne = () => {
        // Selection
        let node = root;
        while (!node.terminal && (node.untried === null ? false : node.untried.length === 0 && node.children.length)) {
          node = this._selectChild(node);
        }
        // Expansion
        if (node.terminal) {
          const value = node.visits > 0 ? (node.total / node.visits) : 0;
          let n = node;
          while (n) { n.visits++; n.total += value; n = n.parent; }
          return;
        }
        if (node.untried === null) node.untried = this._legalActions(node.state);
        if (node.untried.length) {
          const idx = Math.floor(Math.random() * node.untried.length);
          const action = node.untried.splice(idx, 1)[0];
          const res = this._applyAction(node.state, action);
          if (res.terminal) {
            const value = res.value;
            const child = new MCTSNode(null, node, action);
            child.visits = 1;
            child.total = value;
            child.terminal = true;
            child.state = null;
            child.untried = [];
            child.children = [];
            node.children.push(child);
            let n = node;
            while (n) { n.visits++; n.total += value; n = n.parent; }
            return;
          } else {
            const child = new MCTSNode(res.state, node, action);
            node.children.push(child);
            node = child;
          }
        }
        // Rollout
        const value = this._randomPlayout(node.state);
        while (node) { node.visits++; node.total += value; node = node.parent; }
      };
      for (let i = 0; i < iterations; i++) {
        doOne();
        if (i === 0 || (i % 50) === 0) {
          const progress = Math.min(1, i / Math.max(1, iterations));
          try { this.game?.bus?.emit?.('ai:progress', { progress }); } catch {}
          // Yield to allow paints
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const best = this._bestChild(root);
      try { this.game?.bus?.emit?.('ai:progress', { progress: 1 }); } catch {}
      return best?.action || { end: true };
    }

    // Resolve relative to this module so it works in the dev server
    const workerUrl = new URL('../workers/mcts.worker.js', import.meta.url);
    return new Promise((resolve) => {
      let settled = false;
      try {
        const w = new Worker(workerUrl, { type: 'module' });
        w.onmessage = (ev) => {
          if (settled) return;
          const data = ev.data || {};
          // Treat messages with a final result as completion, even if they include progress
          if (data && (data.ok != null)) {
            settled = true;
            try { w.terminate(); } catch {}
            const { ok, action } = data;
            if (ok && action) return resolve(action);
            return resolve(this._search(rootState));
          }
          if (data && typeof data.progress === 'number') {
            // Forward progress to game bus
            try { this.game?.bus?.emit?.('ai:progress', { progress: data.progress }); } catch {}
            return; // keep waiting for result
          }
          // Unknown payload; fallback to local search
          settled = true;
          try { w.terminate(); } catch {}
          resolve(this._search(rootState));
        };
        w.onerror = () => {
          if (settled) return;
          settled = true;
          try { w.terminate(); } catch {}
          resolve(this._search(rootState));
        };
        w.postMessage({
          cmd: 'search',
          rootState,
          iterations: this.iterations,
          rolloutDepth: this.rolloutDepth,
          turn: this.resources?.turns?.turn || 1,
        });
      } catch (_) {
        // If Worker construction fails, fallback synchronously
        resolve(this._search(rootState));
      }
    });
  }

  async takeTurn(player, opponent = null, options = {}) {
    const { resume = false } = options;
    // Start turn: mirror BasicAI semantics
    if (!resume) {
      this.resources.startTurn(player);
      const drawn = player.library.draw(1);
      if (drawn[0]) player.hand.add(drawn[0]);
    }
    if (this.game?.state?.aiPending?.type === 'mcts') {
      this.game.state.aiPending.stage = 'running';
    }

    // Iteratively choose and apply actions using MCTS until we choose to end
    let powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    while (true) {
      const pool = this.resources.pool(player);
      const overloadPlayer = typeof this.resources.pendingOverload === 'function'
        ? this.resources.pendingOverload(player)
        : (this.resources._overloadNext?.get?.(player) || 0);
      const overloadOpponent = typeof this.resources.pendingOverload === 'function'
        ? this.resources.pendingOverload(opponent)
        : (this.resources._overloadNext?.get?.(opponent) || 0);
      const rootState = {
        player,
        opponent,
        pool,
        turn: this.resources.turns.turn,
        powerAvailable,
        overloadNextPlayer: overloadPlayer,
        overloadNextOpponent: overloadOpponent,
      };
      let action;
      if (this.fullSim && this.game) {
        const simRoot = this._buildSimFrom(this.game, player, opponent);
        action = await this._searchFullSimAsync(simRoot);
      } else {
        action = await this._searchAsync(rootState);
      }
      if (!action || action.end) break;
      // Apply chosen action to real game state
      if (action.card) {
        if (this.game && typeof this.game.playFromHand === 'function') {
          const ok = await this.game.playFromHand(player, action.card.id);
          if (!ok) break;
        } else {
          // Fallback (should not happen in game integration)
          const cost = action.card.cost || 0;
          if (!this.resources.pay(player, cost)) break;
          if (action.card.type === 'ally' || action.card.type === 'equipment' || action.card.type === 'quest') {
            player.hand.moveTo(player.battlefield, action.card);
            if (action.card.type === 'equipment') player.hero.equipment = [action.card];
            if (action.card.type === 'ally' && !action.card.keywords?.includes('Rush')) {
              action.card.data = action.card.data || {};
              action.card.data.attacked = true;
            }
          } else {
            player.hand.moveTo(player.graveyard, action.card);
          }
          player.cardsPlayedThisTurn += 1;
        }
      }
      if (action.usePower) {
        if (this.game && typeof this.game.useHeroPower === 'function') {
          const ok = await this.game.useHeroPower(player);
          if (!ok) break;
        } else {
          if (!this.resources.pay(player, 2)) break;
          player.hero.powerUsed = true; powerAvailable = false;
        }
      }
      // Keep hero power availability synced
      powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    }

    // After actions, perform combat like BasicAI (respect Taunt when selecting targets)
    if (this.combat && opponent) {
      this.combat.clear();
      const attackers = [player.hero, ...player.battlefield.cards]
        .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0));
      for (const a of attackers) {
        // Choose a legal defender, honoring Taunt; default to hero if none picked
        const defenders = [
          opponent.hero,
          ...opponent.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')
        ];
        const legal = selectTargets(defenders);
        const preferFace = this._hasHeroAdvantage(player, opponent);
        const heroLegal = legal.some(t => t.id === opponent.hero.id);
        let block = null;
        if (!preferFace || !heroLegal) {
          if (legal.length === 1) {
            const only = legal[0];
            if (only.id !== opponent.hero.id) block = only;
          } else if (legal.length > 1) {
            const choices = legal.filter(t => t.id !== opponent.hero.id);
            // Prefer RNG from game if available for variety
            block = this.game?.rng?.pick ? this.game.rng.pick(choices) : (choices[0] || null);
          }
        }
        const target = (preferFace && heroLegal) ? opponent.hero : (block || opponent.hero);
        // If Rush and just entered, skip if no non-hero block target
        const enteredTurn = a?.data?.enteredTurn;
        const justEntered = !!(enteredTurn && (enteredTurn === (this.resources?.turns?.turn || 0)));
        if (a?.keywords?.includes?.('Rush') && justEntered && !block) continue;
        if (!this.combat.declareAttacker(a, target)) continue;
        if (a.data) a.data.attacked = true;
        // Stealth is lost when a unit attacks (AI - MCTS path)
        if (a?.keywords?.includes?.('Stealth')) {
          a.keywords = a.keywords.filter(k => k !== 'Stealth');
        }
        if (block && target !== opponent.hero) this.combat.assignBlocker(a.id, block);
        if (player?.log) player.log.push(`Attacked ${target.name} with ${a.name}`);
      }
      this.combat.setDefenderHero(opponent.hero);
      this.combat.resolve();

      for (const p of [player, opponent]) {
        const dead = p.battlefield.cards.filter(c => c.data?.dead);
        for (const d of dead) { p.battlefield.moveTo(p.graveyard, d); }
      }
    }

    return true;
  }
}

export default MCTS_AI;
