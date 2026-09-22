import { createDecisionState, getLegalActions } from '../src/js/systems/ai-actions.js';
import { actionSignature } from '../src/js/systems/ai-signatures.js';

const hero = (id, extra = {}) => ({ id, type: 'hero', data: { health: 30, attack: 0 }, ...extra });
const ally = (id, extra = {}) => ({ id, type: 'ally', data: { health: 3, attack: 2 }, ...extra });
const state = (attackers = [], defenders = [], options = {}) => createDecisionState({
  player: { hero: hero('friend'), battlefield: { cards: attackers }, hand: { cards: [] } },
  opponent: { hero: hero('enemy'), battlefield: { cards: defenders } },
  pool: 3, turn: 2, ...options,
});
const attacks = s => getLegalActions(s).filter(action => action.attack);

test('cards, power, and end turn reflect affordability and availability', () => {
  const cheap = { id: 'cheap', cost: 2 };
  const costly = { id: 'costly', cost: 4 };
  const s = state();
  s.player.hand.cards = [cheap, costly];
  s.player.hero.active = [{ type: 'draw' }];
  const actions = getLegalActions(s);
  expect(actions.some(a => a.card === cheap && !a.usePower)).toBe(true);
  expect(actions.some(a => a.card === costly)).toBe(false);
  expect(actions.some(a => a.usePower && !a.card)).toBe(true);
  expect(actions.some(a => a.end)).toBe(true);
  s.player.hero.powerUsed = true;
  expect(getLegalActions(s).some(a => a.usePower)).toBe(false);
});

test('every legal attack target has a distinct stable signature', () => {
  const s = state([ally('attacker')], [ally('a'), ally('b')]);
  const choices = attacks(s);
  expect(choices.map(a => a.attack.targetId)).toEqual(['enemy', 'a', 'b']);
  expect(new Set(choices.map(actionSignature)).size).toBe(3);
  expect(choices.map(actionSignature)).toEqual(attacks(s).map(actionSignature));
  s.opponent.battlefield.cards[0].keywords = ['Taunt'];
  expect(attacks(s).map(a => a.attack.targetId)).toEqual(['a']);
});

test('entry, Rush, Charge, exhaustion, freeze and Windfury govern attacks', () => {
  const entering = ally('entering', { data: { health: 3, attack: 2, enteredTurn: 2 } });
  const s = state([entering], [ally('target')]);
  expect(attacks(s)).toHaveLength(0);
  entering.keywords = ['Rush'];
  expect(attacks(s).map(a => a.attack.targetId)).toEqual(['target']);
  entering.keywords = ['Rush', 'Charge'];
  expect(attacks(s).map(a => a.attack.targetId)).toEqual(['enemy', 'target']);
  entering.data.attacksUsed = 1;
  expect(attacks(s)).toHaveLength(0);
  entering.keywords.push('Windfury');
  expect(attacks(s)).toHaveLength(2);
  entering.data.attacksUsed = 2;
  expect(attacks(s)).toHaveLength(0);
  entering.data.attacksUsed = 0;
  entering.data.freezeTurns = 1;
  expect(attacks(s)).toHaveLength(0);
});

test('hero attacks and targetability exclude dead or hidden defenders', () => {
  const s = state([], [
    ally('dead', { data: { health: 0, attack: 2 } }),
    ally('hidden', { keywords: ['Stealth'] }),
    ally('visible'),
  ]);
  s.player.hero.data.attack = 2;
  expect(attacks(s).map(a => a.attack.targetId)).toEqual(['enemy', 'visible']);
  s.player.hero.data.attacksUsed = 1;
  expect(attacks(s)).toHaveLength(0);
});

test('legal actions do not prune affordable but low-value effects', () => {
  const s = state();
  const heal = { id: 'heal', cost: 1, effects: [{ type: 'heal', amount: 2 }] };
  s.player.hand.cards = [heal];
  expect(getLegalActions(s).some(a => a.card === heal)).toBe(true);
});
