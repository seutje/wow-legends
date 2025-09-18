// Neural network driven AI for "nightmare" difficulty and hybrid policy guidance.
// Uses a small MLP to score Q(s,a) and pick the best action.
// Training uses population-based mutation in tools/train.mjs and stores model at data/models/best.json

import CombatSystem from './combat.js';
import { selectTargets } from './targeting.js';
import MLP from './nn.js';
import { actionSignature } from './ai-signatures.js';

let ActiveModel = null; // module-level active model

export function setActiveModel(model) { ActiveModel = model; }
export function getActiveModel() { return ActiveModel; }

export async function loadModelFromDiskOrFetch() {
  try {
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const path = new URL('../../../data/models/best.json', import.meta.url);
      const txt = await fs.readFile(path, 'utf8');
      const obj = JSON.parse(txt);
      ActiveModel = MLP.fromJSON(obj);
      return ActiveModel;
    } else {
      const res = await fetch(new URL('../../../data/models/best.json', import.meta.url));
      const obj = await res.json();
      ActiveModel = MLP.fromJSON(obj);
      return ActiveModel;
    }
  } catch (_) {
    // If missing, create a fresh random model with default sizes
    ActiveModel = new MLP([38, 64, 64, 1]);
    return ActiveModel;
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function listCards(zone) {
  if (!zone) return [];
  if (Array.isArray(zone)) return zone.filter(Boolean);
  if (Array.isArray(zone.cards)) return zone.cards.filter(Boolean);
  if (typeof zone.size === 'function' && Array.isArray(zone.cards)) return zone.cards.filter(Boolean);
  return [];
}

function getCardStat(card, key) {
  if (!card) return 0;
  const data = card.data || {};
  const direct = data[key];
  if (typeof direct === 'number') return direct;
  const fallback = card[key];
  return typeof fallback === 'number' ? fallback : 0;
}

function hasKeyword(card, keyword) {
  if (!card) return false;
  const kw = card.keywords;
  if (!kw) return false;
  if (Array.isArray(kw)) return kw.includes(keyword);
  if (typeof kw.has === 'function') return kw.has(keyword);
  return false;
}

function summarizeSide(side) {
  const hero = side?.hero || {};
  const heroData = hero.data || {};
  const battlefield = listCards(side?.battlefield);
  const allies = battlefield.filter(c => c && c.type !== 'equipment' && c.type !== 'quest');
  let attackSum = 0;
  let hpSum = 0;
  let maxAttack = 0;
  let tauntCount = 0;
  for (const card of allies) {
    const atk = getCardStat(card, 'attack');
    const hp = getCardStat(card, 'health');
    attackSum += atk;
    hpSum += hp;
    if (atk > maxAttack) maxAttack = atk;
    if (hasKeyword(card, 'Taunt')) tauntCount += 1;
  }
  return {
    heroHealth: heroData.health ?? hero.health ?? 0,
    heroArmor: heroData.armor ?? hero.armor ?? 0,
    handCount: listCards(side?.hand).length,
    alliesCount: allies.length,
    attackSum,
    hpSum,
    maxAttack,
    tauntCount,
  };
}

function stateDescriptorFromLive({
  game = null,
  resources = null,
  player = null,
  opponent = null,
  powerAvailable = false,
  turnOverride = null,
  poolOverride = null,
  opponentPoolOverride = null,
  opponentAvailableOverride = null,
} = {}) {
  const res = resources || game?.resources || null;
  const turn = typeof turnOverride === 'number'
    ? turnOverride
    : (typeof game?.turns?.turn === 'number'
      ? game.turns.turn
      : (typeof res?.turns?.turn === 'number' ? res.turns.turn : 1));
  const fallbackPool = Math.min(10, Math.max(0, turn));
  const pool = typeof poolOverride === 'number'
    ? poolOverride
    : (typeof res?.pool === 'function' ? res.pool(player) : fallbackPool);
  const availRaw = typeof res?.available === 'function' ? res.available(player) : null;
  const playerAvailable = typeof availRaw === 'number' ? availRaw : pool;
  const oppPool = typeof opponentPoolOverride === 'number'
    ? opponentPoolOverride
    : (typeof res?.pool === 'function' ? res.pool(opponent) : fallbackPool);
  const oppAvailRaw = typeof opponentAvailableOverride === 'number'
    ? opponentAvailableOverride
    : (typeof res?.available === 'function' ? res.available(opponent) : null);
  const oppAvailable = typeof oppAvailRaw === 'number' ? oppAvailRaw : oppPool;
  const playerSummary = summarizeSide(player);
  const opponentSummary = summarizeSide(opponent);
  return {
    turn,
    powerAvailable: !!powerAvailable,
    player: {
      ...playerSummary,
      pool: Math.max(0, pool || 0),
      available: Math.max(0, playerAvailable || 0),
    },
    opponent: {
      ...opponentSummary,
      pool: Math.max(0, oppPool || 0),
      available: Math.max(0, oppAvailable || 0),
    },
  };
}

function stateDescriptorFromSnapshot(state = {}) {
  const turn = typeof state.turn === 'number' ? state.turn : 1;
  const fallbackPool = Math.min(10, Math.max(0, turn));
  const playerPool = typeof state.pool === 'number' ? state.pool : fallbackPool;
  const playerAvailable = typeof state.available === 'number' ? state.available : playerPool;
  const opponentPool = typeof state.opponentPool === 'number'
    ? state.opponentPool
    : (typeof state.opponent?.__mctsPool === 'number' ? state.opponent.__mctsPool : fallbackPool);
  const opponentAvailable = typeof state.opponentAvailable === 'number' ? state.opponentAvailable : opponentPool;
  const playerSummary = summarizeSide(state.player || {});
  const opponentSummary = summarizeSide(state.opponent || {});
  return {
    turn,
    powerAvailable: !!state.powerAvailable,
    player: {
      ...playerSummary,
      pool: Math.max(0, playerPool || 0),
      available: Math.max(0, playerAvailable || 0),
    },
    opponent: {
      ...opponentSummary,
      pool: Math.max(0, opponentPool || 0),
      available: Math.max(0, opponentAvailable || 0),
    },
  };
}

function stateFeaturesFromDescriptor(desc = {}) {
  const { player = {}, opponent = {} } = desc;
  return [
    clamp01((desc.turn || 0) / 20),
    clamp01((player.heroHealth || 0) / 40),
    clamp01((player.heroArmor || 0) / 20),
    clamp01((player.pool || 0) / 10),
    clamp01((player.available || 0) / 10),
    clamp01((player.handCount || 0) / 10),
    clamp01((player.alliesCount || 0) / 7),
    clamp01((player.attackSum || 0) / 50),
    clamp01((player.hpSum || 0) / 100),
    clamp01((player.maxAttack || 0) / 20),
    clamp01((opponent.heroHealth || 0) / 40),
    clamp01((opponent.heroArmor || 0) / 20),
    clamp01((opponent.pool || 0) / 10),
    clamp01((opponent.available || 0) / 10),
    clamp01((opponent.handCount || 0) / 10),
    clamp01((opponent.alliesCount || 0) / 7),
    clamp01((opponent.attackSum || 0) / 50),
    clamp01((opponent.hpSum || 0) / 100),
    clamp01((opponent.tauntCount || 0) / 5),
    desc.powerAvailable ? 1 : 0,
  ];
}

function stateFeatures(state) {
  if (!state) return stateFeaturesFromDescriptor();
  if (state.kind === 'live' || state.type === 'live' || state.game || state.resources || state.resourceSystem) {
    return stateFeaturesFromDescriptor(stateDescriptorFromLive({
      game: state.game || null,
      resources: state.resources || state.resourceSystem || null,
      player: state.player || null,
      opponent: state.opponent || null,
      powerAvailable: state.powerAvailable || false,
      turnOverride: typeof state.turn === 'number' ? state.turn : null,
      poolOverride: typeof state.pool === 'number' ? state.pool : null,
      opponentPoolOverride: typeof state.opponentPool === 'number' ? state.opponentPool : null,
      opponentAvailableOverride: typeof state.opponentAvailable === 'number' ? state.opponentAvailable : null,
    }));
  }
  return stateFeaturesFromDescriptor(stateDescriptorFromSnapshot(state));
}

function actionFeatures(action) {
  const isPlay = action?.card ? 1 : 0;
  const isPower = action?.usePower ? 1 : 0;
  const isEnd = action?.end ? 1 : 0;
  let cost = 0, atk = 0, hp = 0, typeEnc = 0;
  let rush = 0, taunt = 0, stealth = 0, divineShield = 0, windfury = 0;
  let battlecry = 0, reflect = 0, lifesteal = 0;
  if (action?.card) {
    const c = action.card;
    cost = c.cost || 0;
    atk = getCardStat(c, 'attack');
    hp = getCardStat(c, 'health');
    typeEnc = (c.type === 'ally' ? 1 : c.type === 'spell' ? 2 : c.type === 'equipment' ? 3 : c.type === 'quest' ? 4 : 0);
    rush = hasKeyword(c, 'Rush') ? 1 : 0;
    taunt = hasKeyword(c, 'Taunt') ? 1 : 0;
    stealth = hasKeyword(c, 'Stealth') ? 1 : 0;
    divineShield = hasKeyword(c, 'Divine Shield') ? 1 : 0;
    windfury = hasKeyword(c, 'Windfury') ? 1 : 0;
    battlecry = hasKeyword(c, 'Battlecry') ? 1 : 0;
    reflect = hasKeyword(c, 'Reflect') ? 1 : 0;
    lifesteal = hasKeyword(c, 'Lifesteal') ? 1 : 0;
  }
  return [
    isPlay, isPower, isEnd,
    clamp01(cost / 10), clamp01(atk / 20), clamp01(hp / 20), clamp01(typeEnc / 4),
    rush, taunt, stealth, divineShield, windfury, battlecry, reflect, lifesteal,
  ];
}

export class NeuralPolicyValueModel {
  constructor({ model = null, temperature = 1 } = {}) {
    this.model = model || ActiveModel || new MLP([38, 64, 64, 1]);
    this.temperature = (typeof temperature === 'number' && temperature > 0) ? temperature : 1;
  }

  evaluate(state, actions = []) {
    const stateVec = stateFeatures(state);
    const actionValues = new Map();
    const policy = new Map();
    const scores = [];
    const keys = [];
    if (Array.isArray(actions)) {
      for (const action of actions) {
        const key = actionSignature(action);
        const vec = stateVec.concat(actionFeatures(action));
        const out = this.model.forward(vec);
        const value = Array.isArray(out) && out.length ? (out[0] || 0) : 0;
        actionValues.set(key, value);
        scores.push(value);
        keys.push(key);
      }
    }
    let stateValue = 0;
    if (scores.length) {
      stateValue = Math.max(...scores);
      const temp = this.temperature || 1;
      const logits = scores.map((v) => v / temp);
      const maxLogit = Math.max(...logits);
      let sumExp = 0;
      const exps = logits.map((v) => {
        const val = Math.exp(v - maxLogit);
        sumExp += val;
        return val;
      });
      if (sumExp > 0) {
        exps.forEach((val, idx) => {
          policy.set(keys[idx], val / sumExp);
        });
      } else {
        const uniform = 1 / keys.length;
        keys.forEach((key) => policy.set(key, uniform));
      }
    }
    return { stateValue, actionValues, policy };
  }
}

export class NeuralAI {
  constructor({ game, resourceSystem, combatSystem, model = null } = {}) {
    this.game = game || null;
    this.resources = resourceSystem;
    this.combat = combatSystem || new CombatSystem();
    this.model = model || ActiveModel || new MLP([38, 64, 64, 1]);
  }

  _legalActions(state) {
    const actions = [];
    const p = state.player; const pool = state.pool;
    const canPower = p.hero?.active?.length && state.powerAvailable && pool >= 2;
    if (canPower) actions.push({ card: null, usePower: true, end: false });
    for (const c of p.hand.cards) {
      if ((c.cost || 0) <= pool) actions.push({ card: c, usePower: false, end: false });
    }
    actions.push({ card: null, usePower: false, end: true });
    return actions;
  }

  _score(state, action) {
    const s = stateFeatures({
      kind: 'live',
      game: this.game,
      resources: this.resources,
      player: state.player,
      opponent: state.opponent,
      powerAvailable: state.powerAvailable,
    });
    const a = actionFeatures(action);
    const x = s.concat(a);
    let y = this.model.forward(x)[0] || 0;
    if (action?.end) {
      const hasPlayable = state.player.hand.cards.some(c => (c.cost || 0) <= state.pool)
        || (state.powerAvailable && state.pool >= 2);
      if (hasPlayable) y -= 0.1;
    }
    return y;
  }

  _chooseAction(state) {
    const actions = this._legalActions(state);
    let best = actions[0];
    let bestV = -Infinity;
    let bestNonEnd = null;
    let bestNonEndV = -Infinity;
    for (const a of actions) {
      const v = this._score(state, a);
      if (v > bestV) { bestV = v; best = a; }
      if (!a.end && v > bestNonEndV) { bestNonEndV = v; bestNonEnd = a; }
    }
    if (best?.end && bestNonEnd) {
      const margin = 0.05;
      if (bestV <= bestNonEndV + margin) return bestNonEnd;
    }
    return best;
  }

  async takeTurn(player, opponent = null) {
    this.resources.startTurn(player);
    const drawn = player.library.draw(1);
    if (drawn[0]) player.hand.add(drawn[0]);

    let powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    while (true) {
      const pool = this.resources.pool(player);
      const state = {
        kind: 'live',
        game: this.game,
        resources: this.resources,
        player,
        opponent,
        powerAvailable,
        pool,
      };
      const action = this._chooseAction(state);
      if (!action || action.end) break;
      if (action.card) {
        const ok = await (this.game?.playFromHand?.(player, action.card.id) ?? false);
        if (!ok) break;
      }
      if (action.usePower) {
        const ok = await (this.game?.useHeroPower?.(player) ?? false);
        if (!ok) break;
        powerAvailable = false;
      }
      powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    }

    this.combat.clear();
    const attackers = [player.hero, ...player.battlefield.cards]
      .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0));
    for (const a of attackers) {
      const defenders = [opponent.hero, ...opponent.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')];
      const legal = selectTargets(defenders);
      let block = null;
      if (legal.length > 1) {
        const nonHero = legal.filter(t => t.id !== opponent.hero.id);
        const taunts = nonHero.filter(t => t.keywords?.includes('Taunt'));
        const poolChoices = (taunts.length ? taunts : nonHero);
        block = poolChoices.sort((x, y) => (x.data?.health || 0) - (y.data?.health || 0))[0] || null;
      } else if (legal.length === 1 && legal[0].id !== opponent.hero.id) {
        block = legal[0];
      }
      const target = block || opponent.hero;
      if (!this.combat.declareAttacker(a, target)) continue;
      if (a.data) a.data.attacked = true;
      if (a?.keywords?.includes?.('Stealth')) a.keywords = a.keywords.filter(k => k !== 'Stealth');
      if (block) this.combat.assignBlocker(a.id, block);
      player.log.push(`Attacked ${target.name} with ${a.name}`);
    }
    this.combat.setDefenderHero(opponent.hero);
    const events = this.combat.resolve();
    for (const ev of events) {
      const srcOwner = [player.hero, ...player.battlefield.cards].includes(ev.source) ? player : opponent;
      this.game?.bus?.emit?.('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
    }
    await this.game?.cleanupDeaths?.(player, opponent);
    await this.game?.cleanupDeaths?.(opponent, player);
    return true;
  }
}

export default NeuralAI;
