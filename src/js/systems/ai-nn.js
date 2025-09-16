// Neural network driven AI for "nightmare" difficulty.
// Uses a small MLP to score Q(s,a) and pick the best action.
// Training uses population-based mutation in tools/train.mjs and stores model at data/model.json

import CombatSystem from './combat.js';
import { selectTargets } from './targeting.js';
import MLP from './nn.js';

let ActiveModel = null; // module-level active model

export function setActiveModel(model) { ActiveModel = model; }
export function getActiveModel() { return ActiveModel; }

export async function loadModelFromDiskOrFetch() {
  try {
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const path = new URL('../../../data/model.json', import.meta.url);
      const txt = await fs.readFile(path, 'utf8');
      const obj = JSON.parse(txt);
      ActiveModel = MLP.fromJSON(obj);
      return ActiveModel;
    } else {
      const res = await fetch(new URL('../../../data/model.json', import.meta.url));
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

// Feature engineering
// State features (player-centric, 20 dims approx):
// [ turn/20, pHP/40, pArmor/20, pPool/10, pAvail/10, pHand/10, pAllies, pAtkSum/50, pHpSum/100, pMaxAtk/20,
//   oHP/40, oArmor/20, oPool/10, oAvail/10, oHand/10, oAllies, oAtkSum/50, oHpSum/100, oTaunts, powerAvail ]
// Action features (18 dims): one-hot type (3), cost/10, cardAtk/20, cardHp/20, type enum (ally=1,spell=2,equip=3,quest=4)/4,
// plus flags: rush, taunt, stealth, divineShield (4).
// Total input ~ 38 dims (20 + 18).

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function stateFeatures({ game, player, opponent, powerAvailable }) {
  const res = game.resources;
  const turn = game?.turns?.turn || 1;
  const pHP = (player.hero?.data?.health ?? 0);
  const pArmor = (player.hero?.data?.armor ?? 0);
  const pPool = res.pool(player);
  const pAvail = res.available(player);
  const pHand = player.hand.size();
  const pAllies = player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment').length;
  const pAtkSum = sum(player.battlefield.cards.map(c => (c.data?.attack || 0)));
  const pHpSum = sum(player.battlefield.cards.map(c => (c.data?.health || 0)));
  const pMaxAtk = max(0, player.battlefield.cards.map(c => (c.data?.attack || 0)));

  const oHP = (opponent.hero?.data?.health ?? 0);
  const oArmor = (opponent.hero?.data?.armor ?? 0);
  const oPool = res.pool(opponent);
  const oAvail = res.available(opponent);
  const oHand = opponent.hand.size();
  const oAllies = opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment').length;
  const oAtkSum = sum(opponent.battlefield.cards.map(c => (c.data?.attack || 0)));
  const oHpSum = sum(opponent.battlefield.cards.map(c => (c.data?.health || 0)));
  const oTaunts = opponent.battlefield.cards.filter(c => c.keywords?.includes('Taunt')).length;

  return [
    clamp01(turn / 20),
    clamp01(pHP / 40), clamp01(pArmor / 20), clamp01(pPool / 10), clamp01(pAvail / 10), clamp01(pHand / 10), clamp01(pAllies / 7),
    clamp01(pAtkSum / 50), clamp01(pHpSum / 100), clamp01(pMaxAtk / 20),
    clamp01(oHP / 40), clamp01(oArmor / 20), clamp01(oPool / 10), clamp01(oAvail / 10), clamp01(oHand / 10), clamp01(oAllies / 7),
    clamp01(oAtkSum / 50), clamp01(oHpSum / 100), clamp01(oTaunts / 5), powerAvailable ? 1 : 0,
  ];
}

function actionFeatures(action) {
  // type one-hot
  const isPlay = action?.card ? 1 : 0;
  const isPower = action?.usePower ? 1 : 0;
  const isEnd = action?.end ? 1 : 0;
  let cost = 0, atk = 0, hp = 0, typeEnc = 0, rush=0, taunt=0, stealth=0, divineShield=0;
  if (action?.card) {
    const c = action.card;
    cost = c.cost || 0;
    atk = c.data?.attack || 0;
    hp = c.data?.health || 0;
    typeEnc = (c.type === 'ally' ? 1 : c.type === 'spell' ? 2 : c.type === 'equipment' ? 3 : c.type === 'quest' ? 4 : 0);
    const kw = c.keywords || [];
    rush = kw.includes('Rush') ? 1 : 0;
    taunt = kw.includes('Taunt') ? 1 : 0;
    stealth = kw.includes('Stealth') ? 1 : 0;
    divineShield = kw.includes('Divine Shield') ? 1 : 0;
  }
  return [
    isPlay, isPower, isEnd,
    clamp01(cost / 10), clamp01(atk / 20), clamp01(hp / 20), clamp01(typeEnc / 4),
    rush, taunt, stealth, divineShield,
    // pad to fixed length if needed later
  ];
}

function sum(arr) { return arr.reduce((a,b)=>a+(b||0),0); }
function max(init, arr) { return arr.reduce((a,b)=>Math.max(a,(b||0)), init); }

export class NeuralAI {
  constructor({ game, resourceSystem, combatSystem, model = null } = {}) {
    this.game = game || null;
    this.resources = resourceSystem;
    this.combat = combatSystem || new CombatSystem();
    this.model = model || ActiveModel || new MLP([38,64,64,1]);
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
    const s = stateFeatures(state);
    const a = actionFeatures(action);
    const x = s.concat(a);
    let y = this.model.forward(x)[0] || 0;
    // Light heuristic to avoid ending early when actions exist
    if (action?.end) {
      const hasPlayable = state.player.hand.cards.some(c => (c.cost || 0) <= state.pool) || (state.powerAvailable && state.pool >= 2);
      if (hasPlayable) y -= 0.1; // small penalty nudging away from premature end
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
    // If best is end while we have any non-end actions, prefer non-end unless it's dramatically worse
    if (best?.end && bestNonEnd) {
      const margin = 0.05; // allow end only if clearly better
      if (bestV <= bestNonEndV + margin) return bestNonEnd;
    }
    return best;
  }

  async takeTurn(player, opponent = null) {
    // Start of turn sequence
    this.resources.startTurn(player);
    const drawn = player.library.draw(1);
    if (drawn[0]) player.hand.add(drawn[0]);

    // Action phase: pick greedily until choose to end
    let powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    while (true) {
      const pool = this.resources.pool(player);
      const state = { game: this.game, player, opponent, powerAvailable, pool };
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
      // Update power availability
      powerAvailable = !!(player.hero?.active?.length) && !player.hero.powerUsed;
    }

    // Combat: simple heuristic similar to easy/MCTS hybrid
    this.combat.clear();
    const attackers = [player.hero, ...player.battlefield.cards]
      .filter(c => (c.type !== 'equipment') && !c.data?.attacked && ((typeof c.totalAttack === 'function' ? c.totalAttack() : c.data?.attack || 0) > 0));
    for (const a of attackers) {
      if (!this.combat.declareAttacker(a)) continue;
      if (a.data) a.data.attacked = true;
      if (a?.keywords?.includes?.('Stealth')) a.keywords = a.keywords.filter(k => k !== 'Stealth');
      const defenders = [opponent.hero, ...opponent.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')];
      const legal = selectTargets(defenders);
      let block = null;
      if (legal.length > 1) {
        // Prefer lowest health taunt, else lowest health unit
        const nonHero = legal.filter(t => t.id !== opponent.hero.id);
        const taunts = nonHero.filter(t => t.keywords?.includes('Taunt'));
        const pool = (taunts.length ? taunts : nonHero);
        block = pool.sort((x,y)=> (x.data?.health||0)-(y.data?.health||0))[0] || null;
      } else if (legal.length === 1 && legal[0].id !== opponent.hero.id) {
        block = legal[0];
      }
      if (block) this.combat.assignBlocker(a.id, block);
      player.log.push(`Attacked ${(block||opponent.hero).name} with ${a.name}`);
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
