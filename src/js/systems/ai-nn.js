// Neural network driven AI for "nightmare" difficulty and hybrid policy guidance.
// Uses a small MLP to score Q(s,a) and pick the best action.
// Training uses population-based mutation in tools/train.mjs and stores model at data/models/best.json

import CombatSystem from './combat.js';
import { selectTargets } from './targeting.js';
import MLP from './nn.js';
import { actionSignature } from './ai-signatures.js';
import { encodeMinion, getLatentSize, loadAutoencoder } from './autoencoder.js';
import { getCardInstanceId, matchesCardIdentifier } from '../utils/card.js';

export const HERO_ID_VOCAB = Object.freeze([
  'hero-anduin-wrynn-high-king-priest',
  'hero-arthas-menethil-deathlord',
  'hero-garrosh-hellscream-warmonger',
  'hero-gul-dan-dark-conjurer',
  'hero-illidan-stormrage-the-betrayer',
  'hero-jaina-proudmoore-archmage',
  'hero-malfurion-stormrage-archdruid',
  'hero-rexxar-beastmaster',
  'hero-sylvanas-windrunner-banshee-queen',
  'hero-thrall-warchief-of-the-horde',
  'hero-tyrande-whisperwind-high-priestess',
  'hero-uther-the-lightbringer',
  'hero-valeera-sanguinar-master-assassin',
  'hero-varian-wrynn-high-king',
]);
const HERO_ID_TO_INDEX = new Map(HERO_ID_VOCAB.map((id, index) => [id, index]));
const HERO_VECTOR_SIZE = HERO_ID_VOCAB.length + 1; // +1 for unknown heroes
const HERO_UNKNOWN_INDEX = HERO_VECTOR_SIZE - 1;
const STATE_BASE_FEATURE_COUNT = 20;
const ACTION_FEATURE_COUNT = 15;
const MAX_BOARD_UNITS = 7;
const HAND_HASH_BUCKETS = 128;
const HAND_COUNT_NORMALIZER = 10;
const LATENT_VECTOR_SIZE = getLatentSize();
const HAND_VECTOR_SIZE = HAND_HASH_BUCKETS;
export const STATE_FEATURE_COUNT =
  STATE_BASE_FEATURE_COUNT
  + HERO_VECTOR_SIZE * 2
  + LATENT_VECTOR_SIZE * 2
  + HAND_VECTOR_SIZE * 2;
export const MODEL_INPUT_SIZE = STATE_FEATURE_COUNT + ACTION_FEATURE_COUNT;
export const DEFAULT_MODEL_SHAPE = Object.freeze([MODEL_INPUT_SIZE, 128, 64, 32, 16, 1]);

export function heroIdToVector(heroId) {
  const vec = new Array(HERO_VECTOR_SIZE).fill(0);
  if (typeof heroId === 'string') {
    const idx = HERO_ID_TO_INDEX.get(heroId);
    if (typeof idx === 'number' && idx >= 0) {
      vec[idx] = 1;
      return vec;
    }
  }
  vec[HERO_UNKNOWN_INDEX] = 1;
  return vec;
}

let ActiveModel = null; // module-level active model

function modelHasExpectedShape(model) {
  if (!model || !Array.isArray(model.sizes)) return false;
  const expected = DEFAULT_MODEL_SHAPE;
  if (model.sizes.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (model.sizes[i] !== expected[i]) return false;
  }
  return true;
}

function isModelCompatible(model) {
  return modelHasExpectedShape(model);
}

function createDefaultModel() {
  return new MLP(DEFAULT_MODEL_SHAPE);
}

function hasForward(model) {
  return typeof model?.forward === 'function';
}

function resolveModel(candidate) {
  if (isModelCompatible(candidate)) return candidate;
  if (candidate && !Array.isArray(candidate?.sizes) && hasForward(candidate)) return candidate;
  if (isModelCompatible(ActiveModel)) return ActiveModel;
  return createDefaultModel();
}

export function setActiveModel(model) {
  if (model == null) {
    ActiveModel = null;
  } else if (isModelCompatible(model)) {
    ActiveModel = model;
  } else {
    ActiveModel = null;
  }
}

export function getActiveModel() {
  return isModelCompatible(ActiveModel) ? ActiveModel : null;
}

export async function loadModelFromDiskOrFetch() {
  try {
    try { await loadAutoencoder(); } catch { /* fallback to zeroed latent vectors */ }
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const path = new URL('../../../data/models/best.json', import.meta.url);
      const txt = await fs.readFile(path, 'utf8');
      const obj = JSON.parse(txt);
      const candidate = MLP.fromJSON(obj);
      if (!isModelCompatible(candidate)) throw new Error('Model shape mismatch');
      ActiveModel = candidate;
      return ActiveModel;
    } else {
      const res = await fetch(new URL('../../../data/models/best.json', import.meta.url));
      const obj = await res.json();
      const candidate = MLP.fromJSON(obj);
      if (!isModelCompatible(candidate)) throw new Error('Model shape mismatch');
      ActiveModel = candidate;
      return ActiveModel;
    }
  } catch (_) {
    // If missing, create a fresh random model with default sizes
    ActiveModel = createDefaultModel();
    return ActiveModel;
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function hashCardId(id) {
  if (typeof id !== 'string') return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function handDictionaryVector(handIds, size = HAND_HASH_BUCKETS) {
  const vec = new Array(size).fill(0);
  if (!Array.isArray(handIds)) return vec;
  for (const id of handIds) {
    if (typeof id !== 'string' || !id) continue;
    const idx = hashCardId(id) % size;
    vec[idx] += 1;
  }
  return vec.map((count) => clamp01(count / HAND_COUNT_NORMALIZER));
}

function sumLatentVectors(minions) {
  const size = getLatentSize();
  const sum = new Array(size).fill(0);
  if (!Array.isArray(minions)) return sum;
  for (const card of minions) {
    const vec = encodeMinion(card);
    if (!Array.isArray(vec)) continue;
    const n = Math.min(size, vec.length);
    for (let i = 0; i < n; i++) {
      const val = Number(vec[i]);
      if (!Number.isNaN(val)) sum[i] += val;
    }
  }
  return sum;
}

function normalizeLatentVector(sumVec, count = 0) {
  const size = getLatentSize();
  const out = new Array(size).fill(0);
  if (!Array.isArray(sumVec)) return out;
  const divisor = Math.max(1, Math.min(MAX_BOARD_UNITS, Number.isFinite(count) ? count : MAX_BOARD_UNITS));
  const max = divisor > 0 ? divisor : 1;
  const n = Math.min(size, sumVec.length);
  for (let i = 0; i < n; i++) {
    const val = Number(sumVec[i]);
    out[i] = clamp01(Number.isNaN(val) ? 0 : val / max);
  }
  return out;
}

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
  const heroId = (typeof hero.id === 'string' && hero.id)
    || (typeof heroData.id === 'string' && heroData.id)
    || null;
  const battlefield = listCards(side?.battlefield);
  const allies = battlefield.filter(c => c && c.type !== 'equipment' && c.type !== 'quest');
  const handCards = listCards(side?.hand);
  const handIds = handCards
    .map((card) => (typeof card?.id === 'string' ? card.id : (typeof card?.data?.id === 'string' ? card.data.id : null)))
    .filter((id) => typeof id === 'string' && id.length > 0);
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
  const latentSum = sumLatentVectors(allies);
  return {
    heroId,
    heroHealth: heroData.health ?? hero.health ?? 0,
    heroArmor: heroData.armor ?? hero.armor ?? 0,
    handCount: handCards.length,
    handIds,
    alliesCount: allies.length,
    attackSum,
    hpSum,
    maxAttack,
    tauntCount,
    latentSum,
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
  const base = [
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
  const playerHeroVec = heroIdToVector(player.heroId);
  const opponentHeroVec = heroIdToVector(opponent.heroId);
  const playerLatent = normalizeLatentVector(player.latentSum, player.alliesCount);
  const opponentLatent = normalizeLatentVector(opponent.latentSum, opponent.alliesCount);
  const playerHandVec = handDictionaryVector(player.handIds);
  const opponentHandVec = handDictionaryVector(opponent.handIds);
  return base.concat(
    playerHeroVec,
    opponentHeroVec,
    playerLatent,
    opponentLatent,
    playerHandVec,
    opponentHandVec,
  );
}

export function stateFeatures(state) {
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
    this.model = resolveModel(model);
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
    this.model = resolveModel(model);
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

  _heroHealth(hero) {
    if (!hero) return null;
    if (typeof hero?.data?.health === 'number') return hero.data.health;
    if (typeof hero?.health === 'number') return hero.health;
    return null;
  }

  _shouldAbortTurn(player, opponent) {
    const playerHealth = this._heroHealth(player?.hero);
    if (typeof playerHealth === 'number' && playerHealth <= 0) return true;
    const opponentHealth = this._heroHealth(opponent?.hero);
    if (typeof opponentHealth === 'number' && opponentHealth <= 0) return true;
    if (this.game?.isGameOver?.()) return true;
    return false;
  }

  async takeTurn(player, opponent = null) {
    if (this._shouldAbortTurn(player, opponent)) return false;
    this.resources.startTurn(player);
    if (this._shouldAbortTurn(player, opponent)) return false;
    const drawn = player.library.draw(1);
    if (drawn[0]) player.hand.add(drawn[0]);
    if (this._shouldAbortTurn(player, opponent)) return false;

    let powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    while (true) {
      if (this._shouldAbortTurn(player, opponent)) break;
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
        const cardRef = getCardInstanceId(action.card) ?? action.card;
        const ok = await (this.game?.playFromHand?.(player, cardRef) ?? false);
        if (!ok) break;
        if (this._shouldAbortTurn(player, opponent)) break;
      }
      if (action.usePower) {
        const ok = await (this.game?.useHeroPower?.(player) ?? false);
        if (!ok) break;
        powerAvailable = false;
        if (this._shouldAbortTurn(player, opponent)) break;
      }
      powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    }

    if (this._shouldAbortTurn(player, opponent)) return true;
    this.combat.clear();
    const attackValue = (entity) => {
      if (!entity) return 0;
      if (typeof entity.totalAttack === 'function') return entity.totalAttack();
      return entity?.data?.attack || 0;
    };
    const maxAttacksFor = (entity) => (entity?.keywords?.includes?.('Windfury') ? 2 : 1);
    const attacksUsedFor = (entity) => (entity?.data?.attacksUsed || 0);
    const canSwing = (entity) => {
      if (!entity) return false;
      if (entity.type === 'equipment') return false;
      if (entity !== player.hero && !player.battlefield.cards.includes(entity)) return false;
      if (entity?.data?.dead) return false;
      if ((entity?.data?.freezeTurns || 0) > 0) return false;
      if (entity?.data?.summoningSick) return false;
      return attackValue(entity) > 0 && attacksUsedFor(entity) < maxAttacksFor(entity);
    };

    const queue = [player.hero, ...player.battlefield.cards]
      .filter(c => c && c.type !== 'equipment')
      .filter(canSwing);

    while (queue.length) {
      if (this._shouldAbortTurn(player, opponent)) break;
      const attacker = queue.shift();
      if (!canSwing(attacker)) continue;

      const defenders = [opponent.hero, ...opponent.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')];
      const legal = selectTargets(defenders);
      if (!legal.length) continue;

      const attackerData = attacker?.data || {};
      const hasRush = !!attacker?.keywords?.includes?.('Rush');
      const hasCharge = !!attacker?.keywords?.includes?.('Charge');
      const currentTurn = typeof this.game?.turns?.turn === 'number' ? this.game.turns.turn : null;
      const enteredTurn = typeof attackerData.enteredTurn === 'number' ? attackerData.enteredTurn : null;
      const justEntered = enteredTurn != null && currentTurn != null && enteredTurn === currentTurn;
      const rushRestricted = hasRush && justEntered && !hasCharge;

      const hero = opponent?.hero || null;
      const nonHero = legal.filter(t => !matchesCardIdentifier(t, hero));
      const heroAllowed = !rushRestricted && legal.some(t => matchesCardIdentifier(t, hero));

      if (!nonHero.length && !heroAllowed) continue;

      let block = null;
      if (nonHero.length) {
        const taunts = nonHero.filter(t => t.keywords?.includes('Taunt'));
        const poolChoices = (taunts.length ? taunts : nonHero);
        block = poolChoices.sort((x, y) => (x.data?.health || 0) - (y.data?.health || 0))[0] || null;
      }

      if (!block && !heroAllowed) continue;
      const target = block || (heroAllowed ? hero : null);
      if (!target) continue;

      await this.game?.throttleAIAction?.(player);
      if (this._shouldAbortTurn(player, opponent)) break;

      this.combat.clear();
      if (!this.combat.declareAttacker(attacker, target)) continue;

      const data = attacker.data || (attacker.data = {});
      data.attacked = true;
      data.attacksUsed = (data.attacksUsed || 0) + 1;
      if (attacker?.keywords?.includes?.('Stealth')) attacker.keywords = attacker.keywords.filter(k => k !== 'Stealth');
      if (block) this.combat.assignBlocker(getCardInstanceId(attacker), block);
      player.log.push(`Attacked ${target.name} with ${attacker.name}`);

      this.combat.setDefenderHero(opponent.hero);
      const events = this.combat.resolve();
      for (const ev of events) {
        const srcOwner = [player.hero, ...player.battlefield.cards].includes(ev.source) ? player : opponent;
        this.game?.bus?.emit?.('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
      }
      if (this.game?._uiRerender) {
        try { this.game._uiRerender(); } catch {}
      }
      await this.game?.cleanupDeaths?.(player, opponent);
      await this.game?.cleanupDeaths?.(opponent, player);
      if (this._shouldAbortTurn(player, opponent)) break;

      if (canSwing(attacker)) queue.push(attacker);
    }
    return true;
  }
}

export default NeuralAI;
