import { getCardInstanceId } from '../utils/card.js';
import { getLegalActions } from './ai-actions.js';

const zoneCards = zone => Array.isArray(zone?.cards) ? zone.cards : (Array.isArray(zone) ? zone : []);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value : '';
const keywords = entity => Array.isArray(entity?.keywords)
  ? entity.keywords.filter(value => typeof value === 'string') : [];
const stat = (entity, key) => number(entity?.data?.[key] ?? entity?.[key]);
const attacksUsed = entity => number(entity?.data?.attacksUsed) ?? (entity?.data?.attacked ? 1 : 0);
const maxAttacks = entity => keywords(entity).includes('Windfury') ? 2 : 1;
const attack = entity => {
  if (typeof entity?.totalAttack === 'function') {
    try { return number(entity.totalAttack()) ?? 0; } catch { /* use stored stats */ }
  }
  const base = stat(entity, 'attack') ?? 0;
  return entity?.type === 'hero'
    ? base + (entity.equipment || []).reduce((sum, item) => sum + (stat(item, 'attack') ?? 0), 0)
    : base;
};

function summarizeEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const amount = number(effect.amount);
  const target = text(effect.target);
  switch (effect.type) {
    case 'damage': return `Deal ${amount ?? 'some'} damage${target ? ` to ${target}` : ''}`;
    case 'heal': return `Restore ${amount ?? 'some'} health${target ? ` to ${target}` : ''}`;
    case 'draw': return `Draw ${amount ?? number(effect.count) ?? 1} card(s)`;
    case 'summon': return `Summon ${number(effect.count) ?? 1} ${text(effect.unit?.name) || 'unit'}(s)`;
    case 'overload': return `Overload ${amount ?? 1}`;
    case 'restore': return `Restore ${amount ?? 'some'} resources`;
    case 'buff': return `Give ${target || 'a target'} ${amount ?? ''} ${text(effect.property) || 'stats'}`.trim();
    case 'equip': return `Equip ${text(effect.item?.name) || 'equipment'}`;
    default: return null;
  }
}

const effectSummary = effects => (Array.isArray(effects) ? effects : [])
  .map(summarizeEffect).filter(Boolean);

// Only explicit, semantic fields are copied. Raw effects, owners and caches stay local.
export function serializeCard(card, { includeCombatStatus = false, includeBoardStatus = false,
  legalActions = [], turn = null } = {}) {
  if (!card) return null;
  const result = {
    id: text(card.id) || null,
    instanceId: text(getCardInstanceId(card)) || null,
    name: text(card.name),
    type: text(card.type),
  };
  const cost = number(card.cost);
  if (cost !== null) result.cost = cost;
  const cardAttack = card.type === 'hero' ? attack(card) : stat(card, 'attack');
  if (cardAttack !== null) result.attack = cardAttack;
  for (const key of ['health', 'maxHealth', 'armor', 'durability', 'spellDamage']) {
    const value = stat(card, key);
    if (value !== null) result[key] = value;
  }
  result.keywords = keywords(card);
  if (text(card.text)) result.text = card.text;
  else {
    const summary = effectSummary(card.effects);
    if (summary.length) result.effects = summary;
  }
  const freezeTurns = stat(card, 'freezeTurns') ?? 0;
  if (includeBoardStatus || includeCombatStatus || card.type === 'hero') {
    result.frozen = freezeTurns > 0;
    if (card.type === 'ally') {
      result.summoningSick = !!card.data?.summoningSick;
      result.attacksUsed = attacksUsed(card);
    }
  }
  if (includeCombatStatus) {
    result.attacksRemaining = Math.max(0, maxAttacks(card) - attacksUsed(card));
    const ownAttacks = legalActions.filter(action => action.attack?.attacker === card);
    result.canAttack = ownAttacks.length > 0;
    if (ownAttacks.length && card.type !== 'hero') {
      const entered = card.data?.enteredTurn === turn;
      if (entered && keywords(card).includes('Rush') && !keywords(card).includes('Charge')) {
        result.attackRestriction = 'rush-cannot-attack-hero';
      }
    }
  } else if (freezeTurns > 0) result.frozen = true;
  return result;
}

function serializeHero(hero, { own = false, state, legalActions } = {}) {
  if (!hero) return null;
  const result = serializeCard(hero, { includeCombatStatus: own, legalActions, turn: state?.turn });
  result.equipment = (hero.equipment || []).map(item => serializeCard(item));
  if (own) {
    result.heroPowerAvailable = legalActions.some(action => action.usePower && !action.card);
    result.heroPower = text(hero.text) || effectSummary(hero.active).join('; ') || null;
  }
  const secretCount = Array.isArray(hero.data?.secrets) ? hero.data.secrets.length : 0;
  if (secretCount) result.secretCount = secretCount;
  return result;
}

export function serializeDecisionState(state, { informationMode = 'player', includeGraveyard = false,
  legalActions = null } = {}) {
  if (informationMode !== 'player' && informationMode !== 'perfect') {
    throw new RangeError(`Unknown information mode: ${informationMode}`);
  }
  const player = state?.player || {};
  const opponent = state?.opponent || {};
  const currentActions = legalActions || getLegalActions(state);
  const turn = number(state?.turn) ?? 0;
  const resourceSystem = state?.game?.resources;
  const maximum = number(resourceSystem?.available?.(player)) ?? Math.min(Math.max(turn, 0), 10);
  const result = {
    turn,
    player: {
      hero: serializeHero(player.hero, { own: true, state, legalActions: currentActions }),
      resources: {
        current: number(state?.pool) ?? 0,
        maximum,
        overloadNextTurn: number(state?.overloadNextPlayer)
          ?? number(resourceSystem?.pendingOverload?.(player)) ?? 0,
      },
      hand: zoneCards(player.hand).map(card => serializeCard(card)),
      handCount: zoneCards(player.hand).length,
      libraryCount: zoneCards(player.library).length,
      boardCapacity: 5,
      board: zoneCards(player.battlefield).map(card => serializeCard(card, {
        includeBoardStatus: true, includeCombatStatus: card?.type === 'ally', legalActions: currentActions, turn,
      })),
    },
    opponent: {
      hero: serializeHero(opponent.hero, { state, legalActions }),
      handCount: zoneCards(opponent.hand).length,
      libraryCount: zoneCards(opponent.library).length,
      board: zoneCards(opponent.battlefield).map(card => serializeCard(card, { includeBoardStatus: true })),
    },
  };
  if (includeGraveyard) {
    result.player.graveyard = zoneCards(player.graveyard).map(card => serializeCard(card));
    result.opponent.graveyard = zoneCards(opponent.graveyard).map(card => serializeCard(card));
  }
  if (informationMode === 'perfect') {
    result.opponent.hand = zoneCards(opponent.hand).map(card => serializeCard(card));
  }
  return result;
}

function describeEntity(entity) {
  if (!entity) return 'enemy hero';
  const name = text(entity.name) || (entity.type === 'hero' ? 'hero' : 'unit');
  const details = [];
  const value = attack(entity);
  const health = stat(entity, 'health');
  if (value || health !== null) details.push(`${value} attack`, `${health ?? '?'} health`);
  const armor = stat(entity, 'armor');
  if (armor) details.push(`${armor} armor`);
  if (keywords(entity).includes('Taunt')) details.push('Taunt');
  return details.length ? `${name} (${details.join(', ')})` : name;
}

function describeAction(action, state) {
  if (action.end) return { type: 'end-turn', description: 'End turn' };
  if (action.attack) {
    const attacker = action.attack.attacker;
    const target = action.attack.target || state?.opponent?.hero;
    return { type: 'attack', description: `${describeEntity(attacker)} attacks enemy ${describeEntity(target)}` };
  }
  const hero = state?.player?.hero;
  const power = text(hero?.text) || effectSummary(hero?.active).join('; ') || 'hero power';
  if (action.card) {
    const card = action.card;
    const details = text(card.text) || effectSummary(card.effects).join('; ');
    const suffix = action.usePower ? `, then use hero power: ${power}` : '';
    return { type: action.usePower ? 'play-card-and-hero-power' : 'play-card',
      description: `Play ${text(card.name) || 'card'}${details ? `: ${details}` : ''}${suffix}` };
  }
  if (action.usePower) return { type: 'hero-power', description: `Use hero power: ${power}` };
  return { type: 'unknown', description: 'Unknown action' };
}

export function serializeLegalActions(actions, state) {
  const actionById = new Map();
  const serializedActions = actions.map((action, index) => {
    const id = `a${index}`;
    actionById.set(id, action);
    return { id, ...describeAction(action, state) };
  });
  return { actions: serializedActions, resolveAction: id => actionById.get(id) || null };
}

export function createRemoteDecisionPayload(state, actions, options = {}) {
  const mapping = serializeLegalActions(actions, state);
  return {
    payload: {
      state: serializeDecisionState(state, { ...options, legalActions: actions }),
      actions: mapping.actions,
    },
    resolveAction: mapping.resolveAction,
  };
}
