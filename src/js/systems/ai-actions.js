import { selectTargets } from './targeting.js';
import { getCardInstanceId, matchesCardIdentifier } from '../utils/card.js';

// Internal decision state. Callers may supply a simulated player and opponent;
// this is deliberately not a public-information or serialization boundary.
export function createDecisionState({ player, opponent, pool = 0, turn = 0,
  powerAvailable = true, enteredThisTurn = new Set(), game = null } = {}) {
  return { player, opponent, pool, turn, powerAvailable, enteredThisTurn, game };
}

const dead = entity => !entity || !!entity.data?.dead || (entity.data?.health ?? entity.health ?? 0) <= 0;
const attacksUsed = entity => entity.data?.attacksUsed ?? (entity.data?.attacked ? 1 : 0);
const attackValue = entity => {
  if (typeof entity.totalAttack === 'function') return entity.totalAttack();
  let value = entity.data?.attack ?? entity.attack ?? 0;
  if (entity.type === 'hero') value += (entity.equipment || []).reduce((sum, item) => sum + (item?.attack ?? item?.data?.attack ?? 0), 0);
  return value;
};

function attackActions(state) {
  const { player, opponent, turn, enteredThisTurn } = state;
  if (!player || !opponent) return [];
  const defenders = [opponent.hero, ...(opponent.battlefield?.cards || [])]
    .filter(entity => entity && entity.type !== 'equipment' && entity.type !== 'quest' && !dead(entity));
  const targets = selectTargets(defenders);
  const attackers = [player.hero, ...(player.battlefield?.cards || [])];
  const actions = [];
  for (const attacker of attackers) {
    if (!attacker || attacker.type === 'equipment' || attacker.type === 'quest' || dead(attacker)) continue;
    if ((attacker.data?.freezeTurns || 0) > 0 || attackValue(attacker) <= 0) continue;
    if (attacksUsed(attacker) >= (attacker.keywords?.includes('Windfury') ? 2 : 1)) continue;
    const isHero = attacker === player.hero;
    const charge = attacker.keywords?.includes('Charge');
    const rush = attacker.keywords?.includes('Rush');
    const entered = !isHero && (attacker.data?.enteredTurn === turn
      || enteredThisTurn?.has?.(getCardInstanceId(attacker)));
    if (!isHero && attacker.data?.summoningSick && !(charge || rush)) continue;
    if (entered && !(charge || rush)) continue;
    for (const target of targets) {
      const targetHero = matchesCardIdentifier(target, opponent.hero);
      if (targetHero && entered && !charge) continue;
      if (targetHero && attacker.data?.summoningSick && !charge) continue;
      actions.push({ card: null, usePower: false, end: false, attack: {
        attackerId: getCardInstanceId(attacker) || attacker.id,
        targetId: getCardInstanceId(target) || target.id || null,
        attackerType: attacker.type || (isHero ? 'hero' : null),
        targetType: target.type || (targetHero ? 'hero' : null),
        attacker, target,
      } });
    }
  }
  return actions;
}

export function getLegalActions(state) {
  const actions = [];
  const { player, pool = 0, game } = state;
  if (!player) return [{ card: null, usePower: false, end: true }];
  const hero = player.hero;
  const powerCost = game?._evaluateFirstHealCostReduction?.(player, hero, { baseCost: 2, sourceType: 'heroPower' })?.cost ?? 2;
  const canPower = !!(state.powerAvailable && hero?.active?.length && !hero.powerUsed
    && !(hero.data?.freezeTurns > 0) && pool >= powerCost);
  if (canPower) actions.push({ card: null, usePower: true, end: false });
  for (const card of player.hand?.cards || []) {
    if (!card) continue;
    const affordable = game?.canPlay ? game.canPlay(player, card) : pool >= (card.cost || 0);
    if (!affordable) continue;
    actions.push({ card, usePower: false, end: false });
    // MCTS supports a compound card + power action. Keep it when both costs fit.
    if (canPower && pool >= (card.cost || 0) + powerCost) {
      actions.push({ card, usePower: true, end: false });
    }
  }
  actions.push(...attackActions(state));
  actions.push({ card: null, usePower: false, end: true });
  return actions;
}
