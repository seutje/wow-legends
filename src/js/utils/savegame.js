import SaveSystem from '../systems/save.js';
import Card from '../entities/card.js';
import Hero from '../entities/hero.js';
import Player from '../entities/player.js';
import Equipment from '../entities/equipment.js';

const GAME_STATE_KEY = 'game-state';
const VERSION = 1;
const LOG_LIMIT = 100;

let _saveInstance = null;
function getSave() {
  if (_saveInstance) return _saveInstance;
  _saveInstance = new SaveSystem({ version: VERSION });
  return _saveInstance;
}

function deepClone(obj) {
  if (obj == null) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

function serializeCard(card) {
  if (!card) return null;
  const base = {
    id: card.id,
    type: card.type,
    name: card.name,
    cost: card.cost ?? 0,
    keywords: Array.isArray(card.keywords) ? Array.from(card.keywords) : [],
    data: card.data ? deepClone(card.data) : {},
    text: card.text ?? '',
    effects: card.effects ? deepClone(card.effects) : [],
    combo: card.combo ? deepClone(card.combo) : [],
    requirement: card.requirement ? deepClone(card.requirement) : null,
    reward: card.reward ? deepClone(card.reward) : [],
  };
  if (card.attack != null) base.attack = card.attack;
  if (card.durability != null) base.durability = card.durability;
  if (card.deathrattle) base.deathrattle = deepClone(card.deathrattle);
  if (card.summonedBy?.id) {
    base.summonedById = card.summonedBy.id;
  } else if (card.summonedBy) {
    base.summonedBy = deepClone({
      id: card.summonedBy.id ?? null,
      type: card.summonedBy.type ?? null,
      name: card.summonedBy.name ?? '',
      text: card.summonedBy.text ?? '',
      keywords: card.summonedBy.keywords ?? [],
      data: card.summonedBy.data ?? null,
      cost: card.summonedBy.cost ?? null,
    });
  }
  return base;
}

function deserializeCard(data, game) {
  if (!data) return null;
  const card = new Card({
    id: data.id,
    type: data.type,
    name: data.name,
    cost: data.cost ?? 0,
    keywords: Array.isArray(data.keywords) ? Array.from(data.keywords) : [],
    data: data.data ? deepClone(data.data) : {},
    text: data.text ?? '',
    effects: data.effects ? deepClone(data.effects) : [],
    combo: data.combo ? deepClone(data.combo) : [],
    requirement: data.requirement ? deepClone(data.requirement) : null,
    reward: data.reward ? deepClone(data.reward) : [],
    attack: data.attack,
    durability: data.durability,
  });
  if (data.deathrattle) card.deathrattle = deepClone(data.deathrattle);
  if (data.summonedById) {
    const base = game?.allCards?.find?.((c) => c.id === data.summonedById);
    if (base) card.summonedBy = base;
    else if (data.summonedBy) card.summonedBy = deepClone(data.summonedBy);
  } else if (data.summonedBy) {
    card.summonedBy = deepClone(data.summonedBy);
  }
  return card;
}

function serializeEquipment(eq) {
  if (!eq) return null;
  return {
    id: eq.id,
    name: eq.name,
    attack: eq.attack ?? 0,
    armor: eq.armor ?? 0,
    durability: eq.durability ?? 0,
    type: eq.type,
  };
}

function deserializeEquipment(data) {
  if (!data) return null;
  return new Equipment({
    id: data.id,
    name: data.name,
    attack: data.attack ?? 0,
    armor: data.armor ?? 0,
    durability: data.durability ?? 0,
  });
}

function serializeHero(hero) {
  if (!hero) return null;
  return {
    id: hero.id,
    name: hero.name,
    data: hero.data ? deepClone(hero.data) : {},
    keywords: Array.isArray(hero.keywords) ? Array.from(hero.keywords) : [],
    text: hero.text ?? '',
    active: hero.active ? deepClone(hero.active) : [],
    passive: hero.passive ? deepClone(hero.passive) : [],
    powerUsed: !!hero.powerUsed,
    equipment: Array.isArray(hero.equipment) ? hero.equipment.map(serializeEquipment) : [],
  };
}

function deserializeHero(data) {
  if (!data) return new Hero();
  const hero = new Hero({
    id: data.id,
    name: data.name,
    data: data.data ? deepClone(data.data) : {},
    keywords: Array.isArray(data.keywords) ? Array.from(data.keywords) : [],
    text: data.text ?? '',
    active: data.active ? deepClone(data.active) : [],
    effects: data.active ? deepClone(data.active) : [],
    passive: data.passive ? deepClone(data.passive) : [],
  });
  hero.powerUsed = !!data.powerUsed;
  hero.equipment = Array.isArray(data.equipment)
    ? data.equipment.map(deserializeEquipment).filter(Boolean)
    : [];
  return hero;
}

function serializeZone(zone) {
  if (!zone?.cards) return [];
  return zone.cards.map((c) => serializeCard(c)).filter(Boolean);
}

function deserializeZone(list, game) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => deserializeCard(c, game)).filter(Boolean);
}

function serializePlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    cardsPlayedThisTurn: player.cardsPlayedThisTurn || 0,
    armorGainedThisTurn: player.armorGainedThisTurn || 0,
    hero: serializeHero(player.hero),
    library: serializeZone(player.library),
    hand: serializeZone(player.hand),
    battlefield: serializeZone(player.battlefield),
    graveyard: serializeZone(player.graveyard),
    removed: serializeZone(player.removed),
    resourcesZone: serializeZone(player.resourcesZone),
    log: Array.isArray(player.log) ? player.log.slice(-LOG_LIMIT) : [],
  };
}

function deserializePlayer(data, game) {
  if (!data) return null;
  const hero = deserializeHero(data.hero);
  const player = new Player({ id: data.id, name: data.name, hero });
  if (player.hero) player.hero.owner = player;
  player.cardsPlayedThisTurn = data.cardsPlayedThisTurn || 0;
  player.armorGainedThisTurn = data.armorGainedThisTurn || 0;
  player.log = Array.isArray(data.log) ? Array.from(data.log) : [];
  player.library.cards = deserializeZone(data.library, game);
  player.hand.cards = deserializeZone(data.hand, game);
  player.battlefield.cards = deserializeZone(data.battlefield, game);
  player.graveyard.cards = deserializeZone(data.graveyard, game);
  player.removed.cards = deserializeZone(data.removed, game);
  player.resourcesZone.cards = deserializeZone(data.resourcesZone, game);
  return player;
}

function serializeQuests(game) {
  const out = { player: [], opponent: [] };
  if (!game?.quests?.active) return out;
  const toList = (arr) => (Array.isArray(arr) ? arr.map((rec) => ({
    cardId: rec?.card?.id ?? null,
    progress: rec?.progress ?? 0,
  })) : []);
  out.player = toList(game.quests.active.get(game.player));
  out.opponent = toList(game.quests.active.get(game.opponent));
  return out;
}

function restoreQuests(game, snapshot) {
  if (!game?.quests) return;
  const map = new Map();
  const hydrate = (player, list) => {
    if (!player || !Array.isArray(list)) return;
    const records = [];
    for (const rec of list) {
      if (!rec?.cardId) continue;
      const card = player.battlefield.cards.find((c) => c.id === rec.cardId);
      if (!card) continue;
      records.push({ card, progress: rec.progress ?? 0 });
    }
    if (records.length) map.set(player, records);
  };
  hydrate(game.player, snapshot?.player);
  hydrate(game.opponent, snapshot?.opponent);
  game.quests.active = map;
}

function serializeResources(game) {
  if (!game?.resources) return null;
  const pools = {
    player: {
      pool: game.resources.pool?.(game.player) ?? 0,
      overload: game.resources.pendingOverload?.(game.player) ?? 0,
    },
    opponent: {
      pool: game.resources.pool?.(game.opponent) ?? 0,
      overload: game.resources.pendingOverload?.(game.opponent) ?? 0,
    }
  };
  return pools;
}

function restoreResources(game, snapshot) {
  if (!game?.resources) return;
  const pools = snapshot || {};
  if (game.player) game.resources.startTurn(game.player);
  if (game.opponent) game.resources.startTurn(game.opponent);
  if (game.player && pools.player) {
    game.resources._pool?.set?.(game.player, pools.player.pool ?? game.resources.available(game.player));
    if (typeof game.resources.setPendingOverload === 'function') {
      game.resources.setPendingOverload(game.player, pools.player.overload ?? 0);
    } else {
      game.resources._overloadNext?.set?.(game.player, pools.player.overload ?? 0);
    }
  }
  if (game.opponent && pools.opponent) {
    game.resources._pool?.set?.(game.opponent, pools.opponent.pool ?? game.resources.available(game.opponent));
    if (typeof game.resources.setPendingOverload === 'function') {
      game.resources.setPendingOverload(game.opponent, pools.opponent.overload ?? 0);
    } else {
      game.resources._overloadNext?.set?.(game.opponent, pools.opponent.overload ?? 0);
    }
  }
}

function findCardInstance(player, cardId) {
  if (!player || !cardId) return null;
  const zones = [player.hand, player.library, player.battlefield, player.graveyard, player.removed];
  for (const zone of zones) {
    const found = zone?.cards?.find?.((c) => c.id === cardId);
    if (found) return found;
  }
  return null;
}

function cloneEffectData(effect) {
  return effect ? deepClone(effect) : null;
}

function reactivateSecret(game, player, token) {
  if (!token || !player?.hero?.data?.secrets) return;
  const effect = token.effect || { type: token.type };
  const card = findCardInstance(player, token.cardId) || null;
  switch (token.type) {
    case 'explosiveTrap':
      game.effects.explosiveTrap(effect, { game, player, card }, { restoreToken: token, skipEmit: true });
      break;
    case 'freezingTrap':
      game.effects.freezingTrap(effect, { game, player, card }, { restoreToken: token, skipEmit: true });
      break;
    case 'snakeTrap':
      game.effects.snakeTrap(effect, { game, player, card }, { restoreToken: token, skipEmit: true });
      break;
    case 'retaliationRunes':
      game.effects.retaliationRunes(effect, { game, player, card }, { restoreToken: token, skipEmit: true });
      break;
    case 'vengefulSpirit':
      game.effects.vengefulSpirit(effect, { game, player, card }, { restoreToken: token, skipEmit: true });
      break;
    case 'counterShot':
    default:
      break;
  }
}

function reactivateCardEffects(game, player, card) {
  if (!card?.effects) return;
  for (const effect of card.effects) {
    if (!effect || typeof effect.type !== 'string') continue;
    switch (effect.type) {
      case 'drawOnHeal':
        game.effects.drawOnHeal(effect, { game, player, card });
        break;
      case 'healAtEndOfTurn':
        game.effects.healAtEndOfTurn(effect, { game, player, card });
        break;
      case 'buffAtEndOfTurn':
        game.effects.buffAtEndOfTurn(effect, { game, player, card });
        break;
      case 'buffOnArmorGain':
        game.effects.buffOnArmorGain(effect, { game, player, card });
        break;
      case 'buffOnSurviveDamage':
        game.effects.buffOnSurviveDamage(effect, { game, player, card });
        break;
      case 'summonBuff':
        game.effects.registerSummonBuff(effect, { game, player, card });
        break;
      default:
        break;
    }
  }
}

function restorePersistentEffects(game) {
  if (!game?.effects) return;
  const apply = (player) => {
    if (!player) return;
    for (const card of player.battlefield?.cards || []) {
      reactivateCardEffects(game, player, card);
    }
    const secrets = Array.isArray(player.hero?.data?.secrets) ? player.hero.data.secrets : [];
    for (const token of secrets) {
      reactivateSecret(game, player, token);
    }
  };
  apply(game.player);
  apply(game.opponent);
}

export function captureGameState(game) {
  if (!game?.player || !game?.opponent || !game?.turns || !game?.resources) return null;
  const state = {
    difficulty: game.state?.difficulty ?? 'easy',
    debug: !!game.state?.debug,
    aiThinking: !!game.state?.aiThinking,
    aiProgress: game.state?.aiProgress ?? 0,
    aiPending: game.state?.aiPending
      ? { type: game.state.aiPending.type || null, stage: game.state.aiPending.stage || 'queued' }
      : null,
    frame: game.state?.frame ?? 0,
    startedAt: game.state?.startedAt ?? Date.now(),
  };
  const turns = {
    turn: game.turns.turn ?? 1,
    current: game.turns.current || 'Start',
    active: game.turns.activePlayer === game.player ? 'player' : 'opponent',
  };
  const snapshot = {
    v: VERSION,
    state,
    turns,
    rng: game.rng?._state ?? null,
    player: serializePlayer(game.player),
    opponent: serializePlayer(game.opponent),
    resources: serializeResources(game),
    quests: serializeQuests(game),
  };
  return snapshot;
}

export function restoreCapturedState(game, snapshot) {
  if (!game || !snapshot || snapshot.v !== VERSION) return false;
  const player = deserializePlayer(snapshot.player, game);
  const opponent = deserializePlayer(snapshot.opponent, game);
  if (!player || !opponent) return false;
  game.player = player;
  game.opponent = opponent;
  if (game.player?.hero) game.player.hero.owner = game.player;
  if (game.opponent?.hero) game.opponent.hero.owner = game.opponent;

  if (!game.state) game.state = {};
  Object.assign(game.state, snapshot.state || {});

  if (snapshot.rng != null && typeof game.rng?.seed === 'function') {
    game.rng.seed(snapshot.rng);
  }

  game.turns.turn = snapshot.turns?.turn ?? 1;
  game.turns.current = snapshot.turns?.current || 'Start';
  const active = snapshot.turns?.active === 'opponent' ? game.opponent : game.player;
  game.turns.setActivePlayer(active);

  restoreResources(game, snapshot.resources);
  restoreQuests(game, snapshot.quests);
  restorePersistentEffects(game);
  return true;
}

export function saveGameState(game) {
  try {
    const snapshot = captureGameState(game);
    if (!snapshot) return false;
    const save = getSave();
    save.storage.setItem(save.key(GAME_STATE_KEY), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadSavedGameState(game) {
  try {
    const save = getSave();
    const raw = save.storage.getItem(save.key(GAME_STATE_KEY));
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    const ok = restoreCapturedState(game, snapshot);
    if (!ok) {
      save.storage.removeItem(save.key(GAME_STATE_KEY));
    }
    return ok;
  } catch {
    return false;
  }
}

export function clearSavedGameState() {
  try {
    const save = getSave();
    save.storage.removeItem(save.key(GAME_STATE_KEY));
  } catch {}
}

export function rememberSecretToken(effect, context, token) {
  if (!token) return token;
  token.effect = token.effect || cloneEffectData(effect);
  token.cardId = token.cardId || context?.card?.id || null;
  return token;
}

export function enrichSecretToken(token) {
  if (!token) return token;
  token.effect = token.effect || null;
  token.cardId = token.cardId || null;
  return token;
}

