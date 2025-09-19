import CombatSystem from './combat.js';
import { selectTargets } from './targeting.js';
import { isTargetable } from './keywords.js';
import { evaluateGameState } from './ai-heuristics.js';
import { actionSignature } from './ai-signatures.js';
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
  constructor({ resourceSystem, combatSystem, game = null, iterations = 500, rolloutDepth = 5, fullSim = false, policyValueModel = null } = {}) {
    this.resources = resourceSystem;
    this.combat = combatSystem;
    this.game = game; // for applying chosen actions correctly
    this.iterations = iterations;
    this.rolloutDepth = rolloutDepth;
    this.fullSim = !!fullSim;
    this.policyValueModel = policyValueModel || null;
    // Prefer offloading search to a Web Worker when available (browser only)
    this._canUseWorker = (typeof window !== 'undefined') && (typeof Worker !== 'undefined');
    this._lastTree = null;
  }

  _clearLastTree() {
    this._lastTree = null;
  }

  _extractZoneCards(zone) {
    if (!zone) return [];
    if (Array.isArray(zone)) return zone;
    if (Array.isArray(zone.cards)) return zone.cards;
    return [];
  }

  _cardSnapshot(card) {
    if (!card) return '';
    const data = card.data || {};
    const attack = data.attack ?? card.attack ?? null;
    const health = data.health ?? card.health ?? null;
    const armor = data.armor ?? card.armor ?? null;
    const durability = data.durability ?? card.durability ?? null;
    const keywords = Array.isArray(card.keywords) ? [...card.keywords].sort().join('.') : '';
    const simpleData = [];
    for (const key of Object.keys(data || {}).sort()) {
      const value = data[key];
      const type = typeof value;
      if (type === 'number' || type === 'boolean') {
        simpleData.push(`${key}:${value}`);
      }
    }
    return [
      card.name || '',
      card.type || '',
      card.cost ?? '',
      attack ?? '',
      health ?? '',
      armor ?? '',
      durability ?? '',
      keywords,
      simpleData.join(','),
    ].join('|');
  }

  _heroSnapshot(hero) {
    if (!hero) return null;
    const data = hero.data || {};
    const equipment = Array.isArray(hero.equipment)
      ? hero.equipment.map((eq) => {
        if (!eq) return '';
        const eqData = eq.data || {};
        const attack = eq.attack ?? eqData.attack ?? '';
        const armor = eq.armor ?? eqData.armor ?? '';
        const durability = eq.durability ?? eqData.durability ?? '';
        const name = eq.name || '';
        const id = eq.id || '';
        return `${name}|${id}|${attack}|${armor}|${durability}`;
      }).join('|')
      : '';
    const keywords = Array.isArray(hero.keywords) ? [...hero.keywords].sort().join('.') : '';
    return {
      id: hero.id || null,
      name: hero.name || null,
      health: data.health ?? hero.health ?? null,
      armor: data.armor ?? hero.armor ?? null,
      attack: data.attack ?? hero.attack ?? null,
      powerUsed: !!hero.powerUsed,
      spellDamage: data.spellDamage ?? hero.spellDamage ?? 0,
      keywords,
      equipment,
    };
  }

  _actionSignature(action) {
    return actionSignature(action);
  }

  _playerSnapshot(player) {
    if (!player) return null;
    const hand = this._extractZoneCards(player.hand);
    const battlefield = this._extractZoneCards(player.battlefield);
    const graveyard = this._extractZoneCards(player.graveyard);
    return {
      id: player.id || null,
      hero: this._heroSnapshot(player.hero),
      hand: hand.map((c) => this._cardSnapshot(c)).join(','),
      battlefield: battlefield.map((c) => this._cardSnapshot(c)).join(','),
      graveyard: graveyard.map((c) => this._cardSnapshot(c)).join(','),
      cardsPlayedThisTurn: player.cardsPlayedThisTurn || 0,
      armorGainedThisTurn: player.armorGainedThisTurn || 0,
    };
  }

  _stateFingerprint(state) {
    if (!state) return null;
    const normalized = {
      turn: state.turn ?? 0,
      pool: state.pool ?? 0,
      powerAvailable: !!state.powerAvailable,
      overloadNextPlayer: state.overloadNextPlayer || 0,
      overloadNextOpponent: state.overloadNextOpponent || 0,
      player: this._playerSnapshot(state.player),
      opponent: this._playerSnapshot(state.opponent),
    };
    try {
      return JSON.stringify(normalized);
    } catch {
      return null;
    }
  }

  _stateFromLive(player, opponent) {
    const turns = this.resources?.turns;
    const turn = turns?.turn ?? 0;
    const pool = typeof this.resources?.pool === 'function'
      ? this.resources.pool(player)
      : 0;
    const overloadPlayer = typeof this.resources?.pendingOverload === 'function'
      ? this.resources.pendingOverload(player)
      : (this.resources?._overloadNext?.get?.(player) || 0);
    const overloadOpponent = typeof this.resources?.pendingOverload === 'function'
      ? this.resources.pendingOverload(opponent)
      : (this.resources?._overloadNext?.get?.(opponent) || 0);
    const powerAvailable = !!(player?.hero?.active?.length) && !player?.hero?.powerUsed;
    const enteredThisTurn = this._collectEnteredThisTurn(player, turn);
    return {
      player,
      opponent,
      pool,
      turn,
      powerAvailable,
      overloadNextPlayer: overloadPlayer,
      overloadNextOpponent: overloadOpponent,
      enteredThisTurn,
    };
  }

  _stateFromSim(sim) {
    if (!sim) return null;
    const res = sim.resources;
    const me = sim.player;
    const opp = sim.opponent;
    const turn = sim.turns?.turn ?? 0;
    const pool = typeof res?.pool === 'function' ? res.pool(me) : 0;
    const overloadPlayer = typeof res?.pendingOverload === 'function'
      ? res.pendingOverload(me)
      : (res?._overloadNext?.get?.(me) || 0);
    const overloadOpponent = typeof res?.pendingOverload === 'function'
      ? res.pendingOverload(opp)
      : (res?._overloadNext?.get?.(opp) || 0);
    const powerAvailable = !!(me?.hero?.active?.length) && !me?.hero?.powerUsed;
    const enteredThisTurn = this._collectEnteredThisTurn(me, turn, sim?.enteredThisTurn);
    sim.enteredThisTurn = enteredThisTurn;
    return {
      player: me,
      opponent: opp,
      pool,
      turn,
      powerAvailable,
      overloadNextPlayer: overloadPlayer,
      overloadNextOpponent: overloadOpponent,
      enteredThisTurn,
    };
  }

  _fingerprintForKind(kind, input) {
    if (kind === 'sim') {
      return this._stateFingerprint(this._stateFromSim(input));
    }
    return this._stateFingerprint(input);
  }

  _fingerprintForNode(kind, node) {
    if (!node || !node.state) return null;
    if (kind === 'sim') {
      return this._stateFingerprint(this._stateFromSim(node.state));
    }
    return this._stateFingerprint(node.state);
  }

  _prepareRootNode(kind, rootInput, buildNode) {
    const fingerprint = this._fingerprintForKind(kind, rootInput);
    const canReuse = !!(fingerprint && this._lastTree && this._lastTree.node && this._lastTree.kind === kind && this._lastTree.signature === fingerprint);
    if (canReuse) {
      this._lastTree.signature = fingerprint;
      this._lastTree.actionChild = null;
      return this._lastTree.node;
    }
    const node = buildNode();
    this._lastTree = {
      node,
      kind,
      signature: fingerprint,
      actionChild: null,
    };
    return node;
  }

  _setLastTreeChoice(node) {
    if (this._lastTree) this._lastTree.actionChild = node || null;
  }

  _advanceLastTreeToChild(kind, child, actualState) {
    if (!child || !child.state) {
      this._clearLastTree();
      return false;
    }
    const expected = this._stateFingerprint(actualState);
    const candidate = this._fingerprintForNode(kind, child);
    if (!expected || !candidate || expected !== candidate) {
      this._clearLastTree();
      return false;
    }
    child.parent = null;
    this._lastTree = {
      node: child,
      kind,
      signature: candidate,
      actionChild: null,
    };
    return true;
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

  _collectFriendlyCharacters(player, { excludeSourceId = null } = {}) {
    const characters = [];
    if (player?.hero && !this._isEntityDead(player.hero)) {
      if ((!excludeSourceId || player.hero.id !== excludeSourceId) && isTargetable(player.hero)) {
        characters.push(player.hero);
      }
    }
    for (const card of player?.battlefield?.cards || []) {
      if (!card || card.type === 'quest') continue;
      if (this._isEntityDead(card)) continue;
      if (excludeSourceId && card.id === excludeSourceId) continue;
      if (!isTargetable(card)) continue;
      characters.push(card);
    }
    return characters;
  }

  _collectFriendlyMinions(player, options = {}) {
    return this._collectFriendlyCharacters(player, options).filter((c) => c?.type === 'ally');
  }

  _collectEnemyCharacters(opponent, { excludeSourceId = null } = {}) {
    const candidates = [];
    if (opponent?.hero && !this._isEntityDead(opponent.hero)) {
      if (!excludeSourceId || opponent.hero.id !== excludeSourceId) candidates.push(opponent.hero);
    }
    for (const card of opponent?.battlefield?.cards || []) {
      if (!card || card.type === 'quest') continue;
      if (this._isEntityDead(card)) continue;
      if (excludeSourceId && card.id === excludeSourceId) continue;
      candidates.push(card);
    }
    return selectTargets(candidates);
  }

  _collectEnemyMinions(opponent, { excludeSourceId = null, enforceTaunt = true } = {}) {
    const minions = [];
    for (const card of opponent?.battlefield?.cards || []) {
      if (!card || card.type !== 'ally') continue;
      if (this._isEntityDead(card)) continue;
      if (excludeSourceId && card.id === excludeSourceId) continue;
      minions.push(card);
    }
    if (!minions.length) return [];
    if (!enforceTaunt) {
      return minions.filter((m) => isTargetable(m));
    }
    return selectTargets(minions);
  }

  _resolveTargetInState(target, player, opponent) {
    if (!target) return null;
    const id = target.id;
    if (id != null) {
      if (player?.hero?.id === id) return player.hero;
      if (opponent?.hero?.id === id) return opponent.hero;
      const findMatch = (cards) => {
        if (!Array.isArray(cards)) return null;
        for (const card of cards) {
          if (card?.id === id) return card;
        }
        return null;
      };
      const inPlayer = findMatch(player?.battlefield?.cards);
      if (inPlayer) return inPlayer;
      const inOpponent = findMatch(opponent?.battlefield?.cards);
      if (inOpponent) return inOpponent;
    }
    if (target === player?.hero) return player.hero;
    if (target === opponent?.hero) return opponent.hero;
    return null;
  }

  _registerActionTarget(action, effect, target, { source = null, index = 0 } = {}) {
    if (!action) return;
    const clean = (value) => {
      if (value == null) return 'none';
      return String(value).replace(/[|;]/g, '_');
    };
    const effectType = clean(effect?.type || 'effect');
    const scope = clean(effect?.target || 'any');
    const srcId = source?.id || source?.hero?.id || source?.name || effectType;
    const entryParts = [
      `src:${clean(srcId)}`,
      `idx:${index}`,
      `eff:${effectType}`,
      `scope:${scope}`,
      `tgt:${clean(target?.id || target?.name || null)}`,
    ];
    const entry = entryParts.join(',');
    if (typeof action.__mctsTargetSignature === 'string' && action.__mctsTargetSignature.length) {
      action.__mctsTargetSignature += `;${entry}`;
    } else {
      action.__mctsTargetSignature = entry;
    }
  }

  _collectDamageTargets(targetType, player, opponent, source = null) {
    const srcId = source?.id || source?.hero?.id || null;
    const friendlyChars = this._collectFriendlyCharacters(player, { excludeSourceId: srcId });
    const friendlyMinions = this._collectFriendlyMinions(player, { excludeSourceId: srcId });
    const enemyChars = this._collectEnemyCharacters(opponent, { excludeSourceId: srcId });
    const enemyMinions = this._collectEnemyMinions(opponent, { excludeSourceId: srcId });
    const build = (targets, mode = 'single') => ({ targets, mode });
    switch (targetType) {
      case 'allCharacters':
        return build([...friendlyChars, ...enemyChars], 'multi');
      case 'allOtherCharacters': {
        const combined = [...friendlyChars, ...enemyChars];
        return build(combined.filter((t) => !srcId || t?.id !== srcId), 'multi');
      }
      case 'allies':
      case 'allFriendlies':
        return build(friendlyChars, 'multi');
      case 'allEnemies':
        return build(enemyChars, 'multi');
      case 'selfHero': {
        const hero = player?.hero;
        const targets = (hero && !this._isEntityDead(hero) && (!srcId || hero.id !== srcId)) ? [hero] : [];
        return build(targets, 'single');
      }
      case 'hero': {
        const targets = [];
        if (player?.hero && !this._isEntityDead(player.hero) && (!srcId || player.hero.id !== srcId)) targets.push(player.hero);
        if (opponent?.hero && !this._isEntityDead(opponent.hero) && (!srcId || opponent.hero.id !== srcId)) targets.push(opponent.hero);
        return build(targets, 'single');
      }
      case 'minion': {
        const targets = [...enemyMinions, ...friendlyMinions];
        return build(targets, 'single');
      }
      case 'enemyHeroOrMinionWithoutTaunt': {
        const candidates = [];
        if (opponent?.hero && !this._isEntityDead(opponent.hero) && (!srcId || opponent.hero.id !== srcId)) {
          candidates.push(opponent.hero);
        }
        for (const card of opponent?.battlefield?.cards || []) {
          if (!card || card.type !== 'ally') continue;
          if (this._isEntityDead(card)) continue;
          if (card.keywords?.includes?.('Taunt')) continue;
          if (!isTargetable(card)) continue;
          if (srcId && card.id === srcId) continue;
          candidates.push(card);
        }
        return build(candidates, 'single');
      }
      case 'any':
      case 'character': {
        const combined = [...enemyChars, ...friendlyChars];
        return build(combined, 'single');
      }
      default: {
        return build(enemyChars.length ? enemyChars : friendlyChars, 'single');
      }
    }
  }

  _collectEnteredThisTurn(player, turn, existing = null) {
    const base = new Set(existing ? Array.from(existing) : []);
    const cards = Array.isArray(player?.battlefield?.cards) ? player.battlefield.cards : [];
    const inPlay = new Set();
    const currentTurn = typeof turn === 'number' ? turn : (this.resources?.turns?.turn ?? null);
    for (const card of cards) {
      if (!card?.id) continue;
      inPlay.add(card.id);
      const data = card.data || {};
      if (data.summoningSick) base.add(card.id);
      const entered = typeof data.enteredTurn === 'number' ? data.enteredTurn : null;
      if (entered != null && currentTurn != null && entered === currentTurn) base.add(card.id);
    }
    for (const id of Array.from(base)) {
      if (!inPlay.has(id)) base.delete(id);
    }
    return base;
  }

  _ensureOwnerLinksForPlayer(player) {
    if (!player) return;
    if (player.hero) {
      player.hero.owner = player;
      if (Array.isArray(player.hero.equipment)) {
        for (const eq of player.hero.equipment) {
          if (eq) eq.owner = player;
        }
      }
    }
    const cards = Array.isArray(player?.battlefield?.cards) ? player.battlefield.cards : [];
    for (const card of cards) {
      if (!card) continue;
      card.owner = player;
    }
  }

  _isEntityDead(entity) {
    if (!entity) return true;
    if (entity?.data?.dead) return true;
    const health = typeof entity?.data?.health === 'number'
      ? entity.data.health
      : (typeof entity?.health === 'number' ? entity.health : 0);
    return health <= 0;
  }

  _attacksUsed(entity) {
    if (!entity?.data) return 0;
    if (typeof entity.data.attacksUsed === 'number') return entity.data.attacksUsed;
    return entity.data.attacked ? 1 : 0;
  }

  _maxAttacksAllowed(entity) {
    if (entity?.keywords?.includes?.('Windfury')) return 2;
    return 1;
  }

  _entityAttackValue(entity) {
    if (!entity) return 0;
    if (typeof entity.totalAttack === 'function') {
      try { return entity.totalAttack(); } catch (_) {}
    }
    let value = 0;
    if (typeof entity?.data?.attack === 'number') value = entity.data.attack;
    else if (typeof entity?.attack === 'number') value = entity.attack;
    if (entity?.type === 'hero' && Array.isArray(entity?.equipment)) {
      for (const eq of entity.equipment) {
        if (!eq) continue;
        const bonus = typeof eq?.attack === 'number'
          ? eq.attack
          : (typeof eq?.data?.attack === 'number' ? eq.data.attack : 0);
        value += bonus;
      }
    }
    return value;
  }

  _entityHealthValue(entity) {
    if (!entity) return 0;
    if (typeof entity?.data?.health === 'number') return entity.data.health;
    if (typeof entity?.health === 'number') return entity.health;
    return 0;
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

  _livingDefenders(opponent) {
    const defenders = [];
    if (opponent?.hero && !this._isEntityDead(opponent.hero)) defenders.push(opponent.hero);
    for (const card of opponent?.battlefield?.cards || []) {
      if (!card) continue;
      if (card.type === 'equipment' || card.type === 'quest') continue;
      if (this._isEntityDead(card)) continue;
      defenders.push(card);
    }
    return defenders;
  }

  _canAttackHero(attacker, player, turn, enteredSet) {
    if (!attacker) return false;
    if (attacker === player?.hero) return true;
    const data = attacker.data || {};
    if (data.summoningSick) return false;
    const hasCharge = attacker?.keywords?.includes?.('Charge');
    const hasRush = attacker?.keywords?.includes?.('Rush');
    const enteredTurn = typeof data.enteredTurn === 'number' ? data.enteredTurn : null;
    const currentTurn = typeof turn === 'number' ? turn : (this.resources?.turns?.turn ?? null);
    const flagged = enteredSet?.has?.(attacker.id);
    const justEntered = flagged || (enteredTurn != null && currentTurn != null && enteredTurn === currentTurn);
    if (justEntered && hasRush && !hasCharge) return false;
    if (justEntered && !(hasCharge || hasRush)) return false;
    return true;
  }

  _chooseAttackTarget(attacker, player, opponent, turn, enteredSet, { legalTargets = null, heroAllowed = null } = {}) {
    const provided = Array.isArray(legalTargets) ? legalTargets : null;
    const defenders = provided || selectTargets(this._livingDefenders(opponent));
    if (!defenders.length) return null;

    const hero = opponent?.hero || null;
    const heroId = hero?.id ?? null;
    const heroInPool = defenders.some((t) => t?.id === heroId);
    const heroEligible = (() => {
      if (!heroInPool) return false;
      if (heroAllowed != null) return heroAllowed;
      return this._canAttackHero(attacker, player, turn, enteredSet);
    })();

    let bestTarget = null;
    let bestScore = -Infinity;

    if (heroEligible && hero) {
      bestTarget = hero;
      bestScore = this._scoreHeroAttack(attacker, hero);
    }

    for (const enemy of defenders) {
      if (!enemy || enemy?.id === heroId) continue;
      const score = this._scoreAllyTrade(attacker, enemy);
      if (!heroEligible && !bestTarget) {
        bestTarget = enemy;
        bestScore = score;
        continue;
      }
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }

    if (!bestTarget && heroEligible && hero) return hero;
    if (!bestTarget) return defenders[0] || null;
    return bestTarget;
  }

  _attackActionsForAttacker(attacker, player, opponent, turn, enteredSet) {
    if (!attacker) return [];
    if (this._isEntityDead(attacker)) return [];
    if ((attacker?.data?.freezeTurns || 0) > 0) return [];
    const attackValue = this._entityAttackValue(attacker);
    if (attackValue <= 0) return [];
    const used = this._attacksUsed(attacker);
    const maxAttacks = this._maxAttacksAllowed(attacker);
    if (used >= maxAttacks) return [];
    const isHero = attacker === player?.hero;
    const data = attacker.data || {};
    const hasCharge = attacker?.keywords?.includes?.('Charge');
    const hasRush = attacker?.keywords?.includes?.('Rush');
    if (!isHero) {
      if (data.dead) return [];
      if (data.summoningSick && !(hasCharge || hasRush)) return [];
      const enteredTurn = typeof data.enteredTurn === 'number' ? data.enteredTurn : null;
      const currentTurn = typeof turn === 'number' ? turn : (this.resources?.turns?.turn ?? null);
      const flagged = enteredSet?.has?.(attacker.id);
      const justEntered = flagged || (enteredTurn != null && currentTurn != null && enteredTurn === currentTurn);
      if (justEntered && !(hasCharge || hasRush)) return [];
    }
    const defenders = this._livingDefenders(opponent);
    const legal = selectTargets(defenders);
    if (!legal.length) return [];
    const hero = opponent?.hero || null;
    const heroId = hero?.id ?? null;
    const heroAllowed = legal.some((t) => t?.id === heroId)
      && this._canAttackHero(attacker, player, turn, enteredSet);
    const pool = heroAllowed ? legal : legal.filter((t) => t?.id !== heroId);
    if (!pool.length) return [];

    const preferred = this._chooseAttackTarget(attacker, player, opponent, turn, enteredSet, {
      legalTargets: pool,
      heroAllowed,
    });

    const chosen = preferred || pool[0] || null;
    if (!chosen) return [];
    const targetHero = chosen === hero;
    const targetId = chosen?.id ?? (targetHero ? hero?.id ?? null : opponent?.hero?.id ?? null);
    const targetType = chosen?.type || (targetHero ? 'hero' : null);
    const attackerType = attacker.type || (isHero ? 'hero' : null);
    return [{
      card: null,
      usePower: false,
      end: false,
      attack: {
        attackerId: attacker.id,
        targetId,
        attackerType,
        targetType,
        attacker,
        target: chosen,
      },
    }];
  }

  _enumerateAttackActionsFor(player, opponent, turn, enteredSet) {
    if (!player || !opponent) return [];
    const actions = [];
    const hero = player.hero;
    if (hero) actions.push(...this._attackActionsForAttacker(hero, player, opponent, turn, enteredSet));
    for (const card of player?.battlefield?.cards || []) {
      if (!card) continue;
      if (card.type === 'equipment' || card.type === 'quest') continue;
      actions.push(...this._attackActionsForAttacker(card, player, opponent, turn, enteredSet));
    }
    return actions;
  }

  _cleanupDead(state) {
    if (!state) return;
    const cleanup = (player, ownerKey) => {
      const cards = Array.isArray(player?.battlefield?.cards) ? player.battlefield.cards : [];
      if (!cards.length) return;
      const survivors = [];
      for (const card of cards) {
        const data = card?.data || {};
        const health = typeof data.health === 'number'
          ? data.health
          : (typeof card?.health === 'number' ? card.health : 0);
        const dead = data.dead || health <= 0;
        if (dead) {
          if (state?.enteredThisTurn?.has?.(card.id)) state.enteredThisTurn.delete(card.id);
          this._clearEnrageTracking(state, ownerKey, card.id);
          const graveyard = Array.isArray(player?.graveyard?.cards) ? player.graveyard.cards : null;
          if (graveyard && !graveyard.some(c => c?.id === card.id)) {
            graveyard.push(card);
          }
        } else {
          survivors.push(card);
        }
      }
      player.battlefield.cards = survivors;
    };
    cleanup(state.player, 'player');
    cleanup(state.opponent, 'opponent');
  }

  _executeAttackAction(state, attack) {
    if (!state || !attack) return false;
    const p = state.player;
    const o = state.opponent;
    const enteredSet = this._collectEnteredThisTurn(p, state.turn, state.enteredThisTurn);
    state.enteredThisTurn = enteredSet;
    const attackerId = attack.attackerId;
    const targetId = attack.targetId;
    if (!attackerId) return false;
    const attacker = (p.hero && p.hero.id === attackerId)
      ? p.hero
      : (p.battlefield?.cards || []).find(c => c?.id === attackerId);
    if (!attacker) return false;
    if ((attacker?.data?.freezeTurns || 0) > 0) return false;
    const attackValue = this._entityAttackValue(attacker);
    if (attackValue <= 0) return false;
    const used = this._attacksUsed(attacker);
    if (used >= this._maxAttacksAllowed(attacker)) return false;
    const targetHero = o.hero && (targetId == null || targetId === o.hero.id);
    let target = null;
    if (targetHero) {
      target = o.hero;
    } else {
      target = (o.battlefield?.cards || []).find(c => c?.id === targetId) || null;
      if (!target) return false;
    }
    const defenders = this._livingDefenders(o);
    let legal = selectTargets(defenders);
    if (targetHero) {
      if (!legal.some(t => t?.id === o.hero?.id)) return false;
    } else {
      if (!legal.some(t => t?.id === target?.id)) return false;
    }
    const data = attacker.data || (attacker.data = {});
    if (attacker !== p.hero) {
      const hasCharge = attacker?.keywords?.includes?.('Charge');
      const hasRush = attacker?.keywords?.includes?.('Rush');
      if (data.summoningSick && !(hasCharge || hasRush)) return false;
      const enteredTurn = typeof data.enteredTurn === 'number' ? data.enteredTurn : null;
      const currentTurn = typeof state.turn === 'number' ? state.turn : (this.resources?.turns?.turn ?? null);
      const flagged = enteredSet?.has?.(attacker.id);
      const justEntered = flagged || (enteredTurn != null && currentTurn != null && enteredTurn === currentTurn);
      if (justEntered && !(hasCharge || hasRush)) return false;
      if (justEntered && hasRush && !hasCharge && targetHero) return false;
    }
    this._ensureOwnerLinksForPlayer(p);
    this._ensureOwnerLinksForPlayer(o);
    data.attack = attackValue;
    const combat = new CombatSystem();
    const actualTarget = targetHero ? o.hero : target;
    if (!combat.declareAttacker(attacker, actualTarget)) return false;
    if (!targetHero && actualTarget) combat.assignBlocker(attacker.id, actualTarget);
    combat.setDefenderHero(o.hero || null);
    const events = combat.resolve();
    this._processCombatEnrage(events, state, p, o);
    data.attacked = true;
    data.attacksUsed = (data.attacksUsed || 0) + 1;
    if (attacker?.keywords?.includes?.('Stealth')) {
      attacker.keywords = attacker.keywords.filter(k => k !== 'Stealth');
    }
    return true;
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
    const { source = null, state = null, action = null } = context;
    for (let index = 0; index < effects.length; index++) {
      const e = effects[index];
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
          const { targets: damageTargets = [], mode: damageMode = 'single' } = this._collectDamageTargets(e.target, player, opponent, source);
          if (damageMode === 'single') {
            if (!damageTargets.length) {
              this._registerActionTarget(action, e, null, { source, index });
              break;
            }
            let chosen = damageTargets[0];
            if (damageTargets.length > 1 && state) {
              let best = null;
              for (const candidate of damageTargets) {
                const preview = this._cloneState(state);
                if (!preview) continue;
                const branchPlayer = preview.player;
                const branchOpponent = preview.opponent;
                const mapped = this._resolveTargetInState(candidate, branchPlayer, branchOpponent);
                if (!mapped) continue;
                this._applyDamageToTarget(mapped, total, { state: preview, player: branchPlayer, opponent: branchOpponent });
                this._cleanupDead(preview);
                const value = this._evaluateRolloutState(preview);
                if (!Number.isFinite(value)) continue;
                if (!best || value > best.value) {
                  best = { value, target: candidate };
                }
              }
              if (best && best.target) chosen = best.target;
            }
            this._applyDamageToTarget(chosen, total, { state, player, opponent });
            this._registerActionTarget(action, e, chosen, { source, index });
          } else {
            for (const target of damageTargets) {
              this._applyDamageToTarget(target, total, { state, player, opponent });
            }
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
            const turnValue = state?.turn ?? (this.resources?.turns?.turn ?? 0);
            summoned.data.enteredTurn = turnValue;
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
    this._ensureOwnerLinksForPlayer(s.player);
    this._ensureOwnerLinksForPlayer(s.opponent);
    s.enteredThisTurn = this._collectEnteredThisTurn(s.player, s.turn, s.enteredThisTurn);
    if ('__policyGuidance' in s) delete s.__policyGuidance;
    return s;
  }

  _legalActions(state) {
    const actions = [];
    const p = state.player;
    const pool = state.pool;
    const enteredSet = this._collectEnteredThisTurn(p, state.turn, state.enteredThisTurn);
    state.enteredThisTurn = enteredSet;
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
    const attackActions = this._enumerateAttackActionsFor(p, state.opponent, state.turn, enteredSet);
    for (const attack of attackActions) actions.push(attack);
    // Always allow ending action phase (proceed to attacks)
    actions.push({ card: null, usePower: false, end: true });
    return actions;
  }

  _applyAction(state, action) {
    const s = this._cloneState(state);
    if (action && Object.prototype.hasOwnProperty.call(action, '__mctsTargetSignature')) {
      delete action.__mctsTargetSignature;
    }
    const p = s.player; const o = s.opponent;
    if (action?.attack) {
      const ok = this._executeAttackAction(s, action.attack);
      if (!ok) return { terminal: true, value: -Infinity };
      this._cleanupDead(s);
      s.enteredThisTurn = this._collectEnteredThisTurn(p, s.turn, s.enteredThisTurn);
      return { terminal: false, state: s };
    }

    if (action.end) {
      this._cleanupDead(s);
      s.enteredThisTurn = this._collectEnteredThisTurn(p, s.turn, s.enteredThisTurn);
      const actions = this._legalActions(s);
      const nonEnd = actions.filter(a => !a.end);
      if (!nonEnd.length) {
        return this._resolveCombatAndScore(s);
      }
      const value = this._evaluateRolloutState(s, { actions });
      return { terminal: true, value: Number.isFinite(value) ? value : 0 };
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
        if (played.type === 'ally') {
          played.data = played.data || {};
          played.data.enteredTurn = s.turn;
          s.enteredThisTurn.add(played.id);
        }
      } else {
        p.graveyard.cards.push(played);
      }
      if (played.effects?.length) {
        // set current state for summon tracking inside effects
        this._currentState = s;
        for (const e of played.effects) { if (e.type === 'overload') s.overloadNextPlayer += (e.amount || 1); }
        s.pool = this._applySimpleEffects(played.effects, p, o, s.pool, { source: played, state: s, action });
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
        s.pool = this._applySimpleEffects(p.hero.active, p, o, s.pool, { source, state: s, action });
        this._currentState = null;
      }
    }
    this._cleanupDead(s);
    s.enteredThisTurn = this._collectEnteredThisTurn(p, s.turn, s.enteredThisTurn);
    return { terminal: false, state: s };
  }

  _heuristicRolloutValue(state) {
    if (!state) return 0;
    const payload = {
      player: state.player,
      opponent: state.opponent,
      turn: typeof state.turn === 'number' ? state.turn : 0,
      resources: typeof state.pool === 'number' ? state.pool : 0,
      overloadNextPlayer: state.overloadNextPlayer || 0,
      overloadNextOpponent: state.overloadNextOpponent || 0,
      enragedOpponentThisTurn: state.enragedOpponentThisTurn,
    };
    const score = evaluateGameState(payload);
    return Number.isFinite(score) ? score : 0;
  }

  _policyGuidanceFor(state, actions = null) {
    if (!this.policyValueModel || !state) return null;
    if (!state.__policyGuidance) {
      const candidates = Array.isArray(actions) ? actions : this._legalActions(state);
      if (!Array.isArray(candidates) || candidates.length === 0) {
        state.__policyGuidance = null;
        return null;
      }
      try {
        const result = this.policyValueModel.evaluate(state, candidates);
        if (!result) {
          state.__policyGuidance = null;
        } else {
          const guidance = {
            stateValue: Number.isFinite(result.stateValue) ? result.stateValue : null,
            actionValues: new Map(),
            policy: new Map(),
          };
          const actionEntries = result.actionValues instanceof Map
            ? Array.from(result.actionValues.entries())
            : Object.entries(result.actionValues || {});
          for (const [sig, val] of actionEntries) {
            if (Number.isFinite(val)) guidance.actionValues.set(sig, val);
          }
          const policyEntries = result.policy instanceof Map
            ? Array.from(result.policy.entries())
            : Object.entries(result.policy || {});
          for (const [sig, val] of policyEntries) {
            if (Number.isFinite(val)) guidance.policy.set(sig, val);
          }
          state.__policyGuidance = guidance;
        }
      } catch (_) {
        state.__policyGuidance = null;
      }
    }
    return state.__policyGuidance;
  }

  _evaluateRolloutState(state, { actions = null } = {}) {
    if (!state) return 0;
    if (this.policyValueModel) {
      const guidance = this._policyGuidanceFor(state, actions);
      if (guidance && Number.isFinite(guidance.stateValue)) {
        return guidance.stateValue;
      }
    }
    return this._heuristicRolloutValue(state);
  }

  _scoreRolloutAction(state, action, { baseline = null, actions = null, guidance = null } = {}) {
    const guide = guidance || this._policyGuidanceFor(state, actions);
    let base;
    if (typeof baseline === 'number') {
      base = baseline;
    } else if (guide && Number.isFinite(guide.stateValue)) {
      base = guide.stateValue;
    } else {
      base = this._heuristicRolloutValue(state);
    }
    const outcome = this._applyAction(state, action);
    if (outcome.terminal) {
      const value = Number.isFinite(outcome.value) ? outcome.value : -Infinity;
      return {
        baseline: base,
        value,
        delta: value - base,
        outcome,
      };
    }
    let value = null;
    if (guide) {
      const sig = this._actionSignature(action);
      const guided = guide.actionValues?.get?.(sig);
      if (Number.isFinite(guided)) value = guided;
    }
    if (!Number.isFinite(value)) {
      const nextScore = this._evaluateRolloutState(outcome.state);
      value = Number.isFinite(nextScore) ? nextScore : 0;
    }
    return {
      baseline: base,
      value,
      delta: value - base,
      outcome,
    };
  }

  _chooseRolloutAction(entries, explorationChance = 0.2, priors = null) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    if (Math.random() < explorationChance) {
      return entries[Math.floor(Math.random() * entries.length)];
    }
    let maxAbs = 0;
    for (const entry of entries) {
      const delta = Number.isFinite(entry?.delta) ? entry.delta : 0;
      const abs = Math.abs(delta);
      if (abs > maxAbs) maxAbs = abs;
    }
    if (maxAbs <= 0) maxAbs = 1;
    const priorMap = priors instanceof Map ? priors : null;
    const weights = entries.map((entry) => {
      const delta = Number.isFinite(entry?.delta) ? entry.delta : 0;
      const normalized = delta / maxAbs;
      const clipped = Math.max(-0.95, Math.min(0.95, normalized));
      let weight = 1 + clipped;
      if (priorMap) {
        const sig = this._actionSignature(entry.action);
        const prior = priorMap.get(sig);
        if (Number.isFinite(prior)) {
          weight *= Math.max(0.05, 0.5 + prior);
        }
      }
      return weight;
    });
    let total = 0;
    for (const weight of weights) total += weight;
    if (total <= 0) {
      return entries[Math.floor(Math.random() * entries.length)];
    }
    let r = Math.random() * total;
    for (let i = 0; i < entries.length; i++) {
      r -= weights[i];
      if (r <= 0) return entries[i];
    }
    return entries[entries.length - 1];
  }

  _pickUntriedAction(node) {
    if (!node || !Array.isArray(node.untried) || node.untried.length === 0) return null;
    if (!this.policyValueModel) {
      const idx = Math.floor(Math.random() * node.untried.length);
      return node.untried.splice(idx, 1)[0];
    }
    const guidance = this._policyGuidanceFor(node.state, node.untried);
    if (!guidance) {
      const idx = Math.floor(Math.random() * node.untried.length);
      return node.untried.splice(idx, 1)[0];
    }
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < node.untried.length; i++) {
      const action = node.untried[i];
      const sig = this._actionSignature(action);
      const prior = Number.isFinite(guidance.policy?.get?.(sig)) ? guidance.policy.get(sig) : 0;
      const value = Number.isFinite(guidance.actionValues?.get?.(sig)) ? guidance.actionValues.get(sig) : 0;
      const score = value + prior;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const [selected] = node.untried.splice(bestIndex, 1);
    return selected;
  }

  _resolveCombatAndScore(state) {
    if (!state) return { terminal: true, value: 0 };
    this._cleanupDead(state);
    const p = state.player; const o = state.opponent;
    const score = evaluateGameState({
      player: p,
      opponent: o,
      turn: state.turn,
      resources: state.pool,
      overloadNextPlayer: state.overloadNextPlayer,
      overloadNextOpponent: state.overloadNextOpponent,
      enragedOpponentThisTurn: state.enragedOpponentThisTurn,
    });
    const value = Number.isFinite(score) ? score : 0;
    return { terminal: true, value };
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
      const guidance = this.policyValueModel ? this._policyGuidanceFor(s, actions) : null;
      const baseScore = guidance && Number.isFinite(guidance.stateValue)
        ? guidance.stateValue
        : this._heuristicRolloutValue(s);
      const baseline = Number.isFinite(baseScore) ? baseScore : 0;
      const scored = pickFrom.map((action) => {
        const scoredAction = this._scoreRolloutAction(s, action, { baseline, actions, guidance });
        return {
          action,
          delta: scoredAction.delta,
          outcome: scoredAction.outcome,
          value: scoredAction.value,
        };
      });
      if (!scored.length) break;
      let choice = this._chooseRolloutAction(scored, 0.2, guidance?.policy);
      if (!choice) {
        choice = scored[Math.floor(Math.random() * scored.length)];
      }
      const result = choice?.outcome;
      if (!result) break;
      if (result.terminal) return result.value;
      s = result.state;
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
    this._ensureOwnerLinksForPlayer(sim.player);
    this._ensureOwnerLinksForPlayer(sim.opponent);
    sim.enteredThisTurn = this._collectEnteredThisTurn(sim.player, sim.turns.turn);
    return sim;
  }

  _legalActionsSim(sim, me) {
    const actions = [];
    if (!sim || !me) {
      actions.push({ card: null, usePower: false, end: true });
      return actions;
    }
    const pool = sim.resources.pool(me);
    const turn = typeof sim.turns?.turn === 'number' ? sim.turns.turn : 0;
    const heroPowerAvailable = !!(me.hero?.active?.length) && !me.hero.powerUsed;
    me.__mctsPool = pool;
    const canPower = heroPowerAvailable && pool >= 2
      && !this._effectsAreUseless(me.hero?.active, me, { pool, turn, powerAvailable: heroPowerAvailable });
    if (canPower) actions.push({ card: null, usePower: true, end: false });
    const enteredSet = this._collectEnteredThisTurn(me, turn, sim?.enteredThisTurn);
    sim.enteredThisTurn = enteredSet;
    for (const c of me.hand.cards) {
      const cost = c.cost || 0;
      if (pool < cost) continue;
      if (this._effectsAreUseless(c.effects, me, { pool, turn, card: c, powerAvailable: heroPowerAvailable })) continue;
      actions.push({ card: c, usePower: false, end: false });
      if (canPower && pool - cost >= 2) actions.push({ card: c, usePower: true, end: false });
    }
    const attackActions = this._enumerateAttackActionsFor(me, sim.opponent, turn, enteredSet);
    for (const attack of attackActions) actions.push(attack);
    actions.push({ card: null, usePower: false, end: true });
    return actions;
  }

  _cloneSim(sim) {
    // Clone from current sim to a fresh sim snapshot
    const cloned = this._buildSimFrom(sim, sim.player, sim.opponent);
    cloned.enteredThisTurn = this._collectEnteredThisTurn(cloned.player, cloned.turns.turn, sim?.enteredThisTurn);
    return cloned;
  }

  async _applyActionSim(sim, action) {
    const s = this._cloneSim(sim);
    const me = s.player; const opp = s.opponent;
    if (action?.attack) {
      const attackerId = action.attack.attackerId;
      const targetId = action.attack.targetId ?? null;
      const ok = await s.attack(me, attackerId, targetId);
      if (!ok) return { terminal: true, value: -Infinity };
      me.__mctsPool = s.resources?.pool?.(me) ?? me.__mctsPool;
      s.enteredThisTurn = this._collectEnteredThisTurn(me, s.turns.turn, s.enteredThisTurn);
      return { terminal: false, state: s };
    }
    if (action.end) {
      s.enteredThisTurn = this._collectEnteredThisTurn(me, s.turns.turn, s.enteredThisTurn);
      const actions = this._legalActionsSim(s, me);
      const nonEnd = actions.filter(a => !a.end);
      if (!nonEnd.length) {
        return await this._resolveCombatAndScoreSim(s);
      }
      const descriptor = this._stateFromSim(s);
      const value = this._evaluateRolloutState(descriptor, { actions });
      const score = Number.isFinite(value) ? value : 0;
      return { terminal: true, value: score };
    }
    if (action.card) {
      const ok = await s.playFromHand(me, action.card.id);
      if (!ok) return { terminal: true, value: -Infinity }; // illegal in sim => punish
    }
    if (action.usePower) {
      const ok = await s.useHeroPower(me);
      if (!ok) return { terminal: true, value: -Infinity };
    }
    me.__mctsPool = s.resources?.pool?.(me) ?? me.__mctsPool;
    s.enteredThisTurn = this._collectEnteredThisTurn(me, s.turns.turn, s.enteredThisTurn);
    return { terminal: false, state: s };
  }

  async _resolveCombatAndScoreSim(sim) {
    const me = sim.player; const opp = sim.opponent;
    const pool = sim.resources?.pool?.(me) ?? 0;
    const overloadPlayer = typeof sim.resources?.pendingOverload === 'function'
      ? sim.resources.pendingOverload(me)
      : (sim.resources?._overloadNext?.get?.(me) || 0);
    const overloadOpponent = typeof sim.resources?.pendingOverload === 'function'
      ? sim.resources.pendingOverload(opp)
      : (sim.resources?._overloadNext?.get?.(opp) || 0);
    const value = evaluateGameState({
      player: me,
      opponent: opp,
      turn: sim.turns.turn,
      resources: pool,
      overloadNextPlayer: overloadPlayer,
      overloadNextOpponent: overloadOpponent,
      enragedOpponentThisTurn: sim.enragedOpponentThisTurn,
    });
    return { terminal: true, value: Number.isFinite(value) ? value : 0 };
  }

  async _randomPlayoutSim(sim) {
    let s = this._cloneSim(sim);
    for (let d = 0; d < this.rolloutDepth; d++) {
      const actions = this._legalActionsSim(s, s.player);
      if (!actions.length) break;
      const nonEnd = actions.filter(a => !a.end);
      const pickFrom = nonEnd.length ? nonEnd : actions;
      const baselineScore = evaluateGameState({
        player: s.player,
        opponent: s.opponent,
        turn: s.turns.turn,
        resources: s.resources.pool(s.player),
        overloadNextPlayer: 0,
        overloadNextOpponent: 0,
      });
      const baseline = Number.isFinite(baselineScore) ? baselineScore : 0;
      const scored = [];
      for (const action of pickFrom) {
        const outcome = await this._applyActionSim(s, action);
        if (outcome.terminal) {
          const value = Number.isFinite(outcome.value) ? outcome.value : -Infinity;
          scored.push({ action, delta: value - baseline, outcome, value });
          continue;
        }
        const next = outcome.state;
        const nextScore = evaluateGameState({
          player: next.player,
          opponent: next.opponent,
          turn: next.turns.turn,
          resources: next.resources.pool(next.player),
          overloadNextPlayer: 0,
          overloadNextOpponent: 0,
        });
        const value = Number.isFinite(nextScore) ? nextScore : 0;
        scored.push({ action, delta: value - baseline, outcome, value });
      }
      if (!scored.length) break;
      let choice = this._chooseRolloutAction(scored);
      if (!choice) {
        choice = scored[Math.floor(Math.random() * scored.length)];
      }
      const result = choice?.outcome;
      if (!result) break;
      if (result.terminal) return result.value;
      s = result.state;
    }
    const res = await this._resolveCombatAndScoreSim(s);
    return res.value;
  }

  async _searchFullSimAsync(rootGame) {
    // Root is a sim snapshot built from the external game state
    const rootSim = rootGame;
    const root = this._prepareRootNode('sim', rootSim, () => new MCTSNode(rootSim));
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
    this._setLastTreeChoice(best);
    return best?.action || { end: true };
  }

  _search(rootState) {
    const root = this._prepareRootNode('state', rootState, () => new MCTSNode(this._cloneState(rootState)));
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
        const action = this._pickUntriedAction(node);
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
    this._setLastTreeChoice(best);
    return best?.action || { end: true };
  }

  // Offload search to a web worker when running in browser on hard difficulty.
  async _searchAsync(rootState) {
    const useWorker = this._canUseWorker && this.game?.state?.difficulty === 'hard';
    if (!useWorker) {
      // Perform incremental search on the main thread, yielding periodically for UI updates
      const root = this._prepareRootNode('state', rootState, () => new MCTSNode(this._cloneState(rootState)));
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
          const action = this._pickUntriedAction(node);
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
      this._setLastTreeChoice(best);
      return best?.action || { end: true };
    }

    this._clearLastTree();
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
    this._clearLastTree();
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
      const enteredThisTurn = this._collectEnteredThisTurn(player, this.resources.turns.turn);
      const rootState = {
        player,
        opponent,
        pool,
        turn: this.resources.turns.turn,
        powerAvailable,
        overloadNextPlayer: overloadPlayer,
        overloadNextOpponent: overloadOpponent,
        enteredThisTurn,
      };
      let action;
      const useSim = this.fullSim && this.game;
      if (useSim) {
        const simRoot = this._buildSimFrom(this.game, player, opponent);
        action = await this._searchFullSimAsync(simRoot);
      } else {
        action = await this._searchAsync(rootState);
      }
      const candidate = this._lastTree?.actionChild || null;
      const searchKind = useSim ? 'sim' : 'state';
      if (!action || action.end) {
        this._clearLastTree();
        break;
      }
      // Apply chosen action to real game state
      if (action.attack) {
        let ok = false;
        if (this.game && typeof this.game.attack === 'function') {
          ok = await this.game.attack(player, action.attack.attackerId, action.attack.targetId ?? null);
        } else {
          const stateView = {
            player,
            opponent,
            turn: this.resources?.turns?.turn || rootState.turn,
            enteredThisTurn: this._collectEnteredThisTurn(player, rootState.turn, enteredThisTurn),
          };
          ok = this._executeAttackAction(stateView, action.attack);
          if (ok) this._cleanupDead(stateView);
        }
        if (!ok) {
          this._clearLastTree();
          break;
        }
      }
      if (action.card) {
        if (this.game && typeof this.game.playFromHand === 'function') {
          const ok = await this.game.playFromHand(player, action.card.id);
          if (!ok) {
            this._clearLastTree();
            break;
          }
        } else {
          // Fallback (should not happen in game integration)
          const cost = action.card.cost || 0;
          if (!this.resources.pay(player, cost)) {
            this._clearLastTree();
            break;
          }
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
          if (!ok) {
            this._clearLastTree();
            break;
          }
        } else {
          if (!this.resources.pay(player, 2)) {
            this._clearLastTree();
            break;
          }
          player.hero.powerUsed = true;
        }
      }
      // Keep hero power availability synced
      const descriptor = this._stateFromLive(player, opponent);
      this._advanceLastTreeToChild(searchKind, candidate, descriptor);
      powerAvailable = descriptor.powerAvailable;
    }

    if (opponent) {
      let combat = this.combat || null;
      const temporaryCombat = !combat;
      if (temporaryCombat) combat = new CombatSystem();
      if (combat) {
        combat.clear();
        const enteredSet = this._collectEnteredThisTurn(player, this.resources.turns.turn);
        const attackers = [player.hero, ...player.battlefield.cards]
          .filter((c) => (c?.type !== 'equipment') && !c?.data?.attacked && (this._entityAttackValue(c) > 0));
        let declared = false;
        for (const attacker of attackers) {
          const target = this._chooseAttackTarget(attacker, player, opponent, this.resources.turns.turn, enteredSet);
          if (!target) continue;
          if (!combat.declareAttacker(attacker, target)) continue;
          if (target?.id && target.id !== opponent.hero?.id) combat.assignBlocker(attacker.id, target);
          if (attacker?.data) {
            attacker.data.attacked = true;
            attacker.data.attacksUsed = (attacker.data.attacksUsed || 0) + 1;
          }
          declared = true;
        }
        if (declared) {
          combat.setDefenderHero(opponent.hero);
          combat.resolve();
          for (const p of [player, opponent]) {
            const dead = p.battlefield.cards.filter(c => c.data?.dead);
            for (const d of dead) {
              p.battlefield.moveTo(p.graveyard, d);
            }
          }
        }
      }
    }
    return true;
  }
}

export default MCTS_AI;
