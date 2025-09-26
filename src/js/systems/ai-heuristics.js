import { getCardInstanceId } from '../utils/card.js';

export const TURN_WEIGHT = 0.1;
export const AI_HEALTH_WEIGHT = 5;
export const PLAYER_HEALTH_WEIGHT = -5;
export const AI_HAND_WEIGHT = 0.2;
export const PLAYER_HAND_WEIGHT = -AI_HAND_WEIGHT;
export const AI_BOARD_ALLY_WEIGHT = 5;
export const PLAYER_BOARD_ALLY_WEIGHT = -AI_BOARD_ALLY_WEIGHT;
export const AI_BOARD_ATTACK_WEIGHT = 1.5;
export const PLAYER_BOARD_ATTACK_WEIGHT = -AI_BOARD_ATTACK_WEIGHT;
export const AI_BOARD_HEALTH_WEIGHT = 1;
export const PLAYER_BOARD_HEALTH_WEIGHT = -AI_BOARD_HEALTH_WEIGHT;
export const AI_EQUIPMENT_WEIGHT = 2;
export const PLAYER_EQUIPMENT_WEIGHT = -2;
export const AI_GRAVEYARD_WEIGHT = 0.5;
export const PLAYER_GRAVEYARD_WEIGHT = -0.5;
// Spending resources alone shouldn't improve the score but the penalty
// should not outweigh meaningful board advances.
export const RESOURCE_WEIGHT = 0.05;
export const TAUNT_WEIGHT = 2;
export const FREEZE_WEIGHT = -2;
// Overload is generally bad for the AI (less resources next turn).
export const AI_OVERLOAD_WEIGHT = -1;
export const PLAYER_OVERLOAD_WEIGHT = 1;
export const WIN_CONDITION_BONUS = 1000;
export const ENEMY_ENRAGED_BASE_PENALTY = 20;
export const ENEMY_ENRAGED_ATTACK_WEIGHT = 8;

function countKeyword(cards, keyword) {
  return cards.filter(c => c?.keywords?.includes?.(keyword)).length;
}

function countFrozen(player) {
  const chars = [player.hero, ...(player.battlefield?.cards || [])];
  return chars.filter(c => (c?.data?.freezeTurns || 0) > 0).length;
}

function sumAllyStats(cards) {
  const totals = { attack: 0, health: 0 };
  if (!Array.isArray(cards)) return totals;
  for (const card of cards) {
    if (!card || card.type !== 'ally') continue;
    const attack = Number(card?.data?.attack ?? 0);
    if (Number.isFinite(attack) && attack > 0) totals.attack += attack;
    const health = Number(card?.data?.health ?? 0);
    if (Number.isFinite(health) && health > 0) totals.health += health;
  }
  return totals;
}

export function evaluateGameState({
  player,
  opponent,
  turn = 1,
  resources = 0,
  overloadNextPlayer = 0,
  overloadNextOpponent = 0,
  enragedOpponentThisTurn = null,
}) {
  let score = 0;

  const aiHealth = player.hero?.data?.health ?? 0;
  const oppHealth = opponent.hero?.data?.health ?? 0;
  score += aiHealth * AI_HEALTH_WEIGHT;
  score += oppHealth * PLAYER_HEALTH_WEIGHT;

  score += (player.hand?.cards?.length || 0) * AI_HAND_WEIGHT;
  score += (opponent.hand?.cards?.length || 0) * PLAYER_HAND_WEIGHT;

  const aiAllies = player.battlefield?.cards?.filter?.(c => c.type === 'ally').length || 0;
  const oppAllies = opponent.battlefield?.cards?.filter?.(c => c.type === 'ally').length || 0;
  score += aiAllies * AI_BOARD_ALLY_WEIGHT;
  score += oppAllies * PLAYER_BOARD_ALLY_WEIGHT;

  const aiStats = sumAllyStats(player.battlefield?.cards);
  const oppStats = sumAllyStats(opponent.battlefield?.cards);
  score += aiStats.attack * AI_BOARD_ATTACK_WEIGHT;
  score += oppStats.attack * PLAYER_BOARD_ATTACK_WEIGHT;
  score += aiStats.health * AI_BOARD_HEALTH_WEIGHT;
  score += oppStats.health * PLAYER_BOARD_HEALTH_WEIGHT;

  const aiEq = player.hero?.equipment?.length || 0;
  const oppEq = opponent.hero?.equipment?.length || 0;
  score += aiEq * AI_EQUIPMENT_WEIGHT;
  score += oppEq * PLAYER_EQUIPMENT_WEIGHT;

  score += (player.graveyard?.cards?.length || 0) * AI_GRAVEYARD_WEIGHT;
  score += (opponent.graveyard?.cards?.length || 0) * PLAYER_GRAVEYARD_WEIGHT;

  score += resources * RESOURCE_WEIGHT;
  score += turn * TURN_WEIGHT;

  // Pending overload next turn: bad for AI, good if opponent has it.
  score += (overloadNextPlayer || 0) * AI_OVERLOAD_WEIGHT;
  score += (overloadNextOpponent || 0) * PLAYER_OVERLOAD_WEIGHT;

  score += countKeyword(player.battlefield?.cards || [], 'Taunt') * TAUNT_WEIGHT;
  score -= countKeyword(opponent.battlefield?.cards || [], 'Taunt') * TAUNT_WEIGHT;

  score += countFrozen(opponent) * -FREEZE_WEIGHT; // frozen enemy is good -> subtract negative
  score += countFrozen(player) * FREEZE_WEIGHT;

  if (oppHealth <= 0) score += WIN_CONDITION_BONUS;
  if (aiHealth <= 0) score -= WIN_CONDITION_BONUS;

  const toMap = (value) => {
    if (!value) return new Map();
    if (value instanceof Map) return value;
    if (value instanceof Set) return new Map(Array.from(value, id => [id, 1]));
    if (Array.isArray(value)) return new Map(value);
    return new Map();
  };
  const enemyEnraged = toMap(enragedOpponentThisTurn);
  if (enemyEnraged.size > 0) {
    for (const card of opponent.battlefield?.cards || []) {
      const key = getCardInstanceId(card);
      if (!key || !enemyEnraged.has(key)) continue;
      const health = card?.data?.health ?? 0;
      if (health <= 0) continue;
      const effects = Array.isArray(card?.effects)
        ? card.effects.filter((fx) => fx?.type === 'buffOnSurviveDamage')
        : [];
      if (!effects.length) continue;
      const attackGain = effects.reduce((sum, fx) => sum + (fx.attack || 0), 0);
      const triggers = Math.max(1, enemyEnraged.get(key) || 1);
      const penalty = (ENEMY_ENRAGED_BASE_PENALTY + Math.max(0, attackGain) * ENEMY_ENRAGED_ATTACK_WEIGHT) * triggers;
      score -= penalty;
    }
  }

  return score;
}

export default evaluateGameState;
