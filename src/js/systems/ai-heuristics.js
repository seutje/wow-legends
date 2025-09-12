export const TURN_WEIGHT = 0.1;
export const AI_HEALTH_WEIGHT = 5;
export const PLAYER_HEALTH_WEIGHT = -5;
export const AI_HAND_WEIGHT = 1;
export const PLAYER_HAND_WEIGHT = -1;
export const AI_BOARD_ALLY_WEIGHT = 3;
export const PLAYER_BOARD_ALLY_WEIGHT = -3;
export const AI_EQUIPMENT_WEIGHT = 2;
export const PLAYER_EQUIPMENT_WEIGHT = -2;
export const AI_GRAVEYARD_WEIGHT = 0.5;
export const PLAYER_GRAVEYARD_WEIGHT = -0.5;
// Spending resources alone shouldn't improve the score.
// Positive weight encourages saving resources so actions that
// don't meaningfully change the game state aren't preferred.
export const RESOURCE_WEIGHT = 0.3;
export const TAUNT_WEIGHT = 2;
export const FREEZE_WEIGHT = -2;
export const WIN_CONDITION_BONUS = 1000;

function countKeyword(cards, keyword) {
  return cards.filter(c => c?.keywords?.includes?.(keyword)).length;
}

function countFrozen(player) {
  const chars = [player.hero, ...(player.battlefield?.cards || [])];
  return chars.filter(c => (c?.data?.freezeTurns || 0) > 0).length;
}

export function evaluateGameState({ player, opponent, turn = 1, resources = 0 }) {
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

  const aiEq = player.hero?.equipment?.length || 0;
  const oppEq = opponent.hero?.equipment?.length || 0;
  score += aiEq * AI_EQUIPMENT_WEIGHT;
  score += oppEq * PLAYER_EQUIPMENT_WEIGHT;

  score += (player.graveyard?.cards?.length || 0) * AI_GRAVEYARD_WEIGHT;
  score += (opponent.graveyard?.cards?.length || 0) * PLAYER_GRAVEYARD_WEIGHT;

  score += resources * RESOURCE_WEIGHT;
  score += turn * TURN_WEIGHT;

  score += countKeyword(player.battlefield?.cards || [], 'Taunt') * TAUNT_WEIGHT;
  score -= countKeyword(opponent.battlefield?.cards || [], 'Taunt') * TAUNT_WEIGHT;

  score += countFrozen(opponent) * -FREEZE_WEIGHT; // frozen enemy is good -> subtract negative
  score += countFrozen(player) * FREEZE_WEIGHT;

  if (oppHealth <= 0) score += WIN_CONDITION_BONUS;
  if (aiHealth <= 0) score -= WIN_CONDITION_BONUS;

  return score;
}

export default evaluateGameState;
