import CombatSystem from './combat.js';
import { selectTargets } from './targeting.js';
import { evaluateGameState } from './ai-heuristics.js';
import Card from '../entities/card.js';

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
  }

  ucb1(c = 1.4) {
    if (this.visits === 0) return Infinity;
    const mean = this.total / this.visits;
    const exploration = c * Math.sqrt(Math.log(this.parent.visits + 1) / this.visits);
    return mean + exploration;
  }
}

export class MCTS_AI {
  constructor({ resourceSystem, combatSystem, game = null, iterations = 300, rolloutDepth = 4 } = {}) {
    this.resources = resourceSystem;
    this.combat = combatSystem;
    this.game = game; // for applying chosen actions correctly
    this.iterations = iterations;
    this.rolloutDepth = rolloutDepth;
  }

  // Heuristic: skip actions that have no effect for common types
  _effectsAreUseless(effects = [], player) {
    if (!effects?.length) return false;
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
          const avail = Math.min(this.resources.turns.turn, 10);
          const used = avail - (player.__mctsPool ?? avail);
          if (used > 0 && (!e.requiresSpent || used >= e.requiresSpent)) useful = true;
          break;
        }
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
    };
    // track pool on the cloned player to reason about restore-spent conditions
    s.player.__mctsPool = s.pool;
    return s;
  }

  _legalActions(state) {
    const actions = [];
    const p = state.player;
    const pool = state.pool;
    const canPower = p.hero?.active?.length && state.powerAvailable && pool >= 2 && !this._effectsAreUseless(p.hero.active, p);
    if (canPower) actions.push({ card: null, usePower: true, end: false });
    for (const c of p.hand.cards) {
      const cost = c.cost || 0;
      if (pool < cost) continue;
      if (this._effectsAreUseless(c.effects, p)) continue;
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
          p.hero.equipment = p.hero.equipment || [];
          p.hero.equipment.push(played);
        }
        if (played.type === 'ally' && !played.keywords?.includes('Rush')) {
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
        s.pool = this._applySimpleEffects(played.effects, p, o, s.pool);
        this._currentState = null;
      }
    }

    if (action.usePower) {
      s.pool -= 2; p.__mctsPool = s.pool;
      s.powerAvailable = false;
      if (p.hero.active?.length) {
        this._currentState = s;
        for (const e of p.hero.active) { if (e.type === 'overload') s.overloadNextPlayer += (e.amount || 1); }
        s.pool = this._applySimpleEffects(p.hero.active, p, o, s.pool);
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
        if (entered && !rush) return false;
        return !c.data?.attacked;
      });
    for (const a of attackers) {
      if (!combat.declareAttacker(a)) continue;
      if (a.data) a.data.attacked = true;
      // Assign a blocker obeying Taunt (similar to real flow)
      const defenders = [
        o.hero,
        ...o.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')
      ];
      const legal = selectTargets(defenders);
      let block = null;
      if (legal.length === 1) {
        const only = legal[0];
        if (only.id !== o.hero.id) block = only;
      } else if (legal.length > 1) {
        const choices = legal.filter(t => t.id !== o.hero.id);
        block = choices[0] || null;
      }
      if (block) combat.assignBlocker(a.id, block);
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

    const score = evaluateGameState({
      player: p,
      opponent: o,
      turn: state.turn,
      resources: state.pool,
      overloadNextPlayer: state.overloadNextPlayer,
      overloadNextOpponent: state.overloadNextOpponent,
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

  _search(rootState) {
    const root = new MCTSNode(this._cloneState(rootState));
    for (let i = 0; i < this.iterations; i++) {
      // Selection
      let node = root;
      while (node.untried === null ? false : node.untried.length === 0 && node.children.length) {
        node = node.children.reduce((a, b) => (a.ucb1() > b.ucb1() ? a : b));
      }
      // Expansion
      if (node.untried === null) node.untried = this._legalActions(node.state);
      if (node.untried.length) {
        const idx = Math.floor(Math.random() * node.untried.length);
        const action = node.untried.splice(idx, 1)[0];
        const res = this._applyAction(node.state, action);
        if (res.terminal) {
          // Rollout is trivial: already terminal
          const value = res.value;
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
    return best?.action || { end: true };
  }

  async takeTurn(player, opponent = null) {
    // Start turn: mirror BasicAI semantics
    this.resources.startTurn(player);
    const drawn = player.library.draw(1);
    if (drawn[0]) player.hand.add(drawn[0]);

    // Iteratively choose and apply actions using MCTS until we choose to end
    let powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    while (true) {
      const pool = this.resources.pool(player);
      const rootState = {
        player,
        opponent,
        pool,
        turn: this.resources.turns.turn,
        powerAvailable,
        overloadNextPlayer: 0,
        overloadNextOpponent: 0,
      };
      const action = this._search(rootState);
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
            player.hand.moveTo(player.battlefield, action.card.id);
            if (action.card.type === 'equipment') player.hero.equipment.push(action.card);
            if (action.card.type === 'ally' && !action.card.keywords?.includes('Rush')) {
              action.card.data = action.card.data || {};
              action.card.data.attacked = true;
            }
          } else {
            player.hand.moveTo(player.graveyard, action.card.id);
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

    // After actions, perform combat like BasicAI
    if (this.combat && opponent) {
      this.combat.clear();
      const attackers = [player.hero, ...player.battlefield.cards]
        .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0));
      for (const a of attackers) {
        if (this.combat.declareAttacker(a)) {
          if (a.data) a.data.attacked = true;
          // Stealth is lost when a unit attacks (AI - MCTS path)
          if (a?.keywords?.includes?.('Stealth')) {
            a.keywords = a.keywords.filter(k => k !== 'Stealth');
          }
        }
      }
      this.combat.setDefenderHero(opponent.hero);
      this.combat.resolve();

      for (const p of [player, opponent]) {
        const dead = p.battlefield.cards.filter(c => c.data?.dead);
        for (const d of dead) { p.battlefield.moveTo(p.graveyard, d.id); }
      }
    }

    return true;
  }
}

export default MCTS_AI;
