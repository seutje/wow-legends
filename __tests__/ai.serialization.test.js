import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import { createDecisionState, getLegalActions } from '../src/js/systems/ai-actions.js';
import {
  serializeCard, serializeDecisionState, serializeLegalActions, createRemoteDecisionPayload,
} from '../src/js/systems/ai-serialization.js';

function decision() {
  const game = new Game();
  game.turns.turn = 4;
  game.resources.startTurn(game.player);
  game.player.hero.active = [{ type: 'draw', amount: 1 }];
  game.player.hero.text = 'Insight — Draw a card.';
  const first = new Card({ id: 'shared-template', name: 'Scout', type: 'ally', cost: 1,
    data: { attack: 2, health: 3 }, text: 'A small scout.' });
  const second = new Card({ id: 'shared-template', name: 'Scout', type: 'ally', cost: 1,
    data: { attack: 2, health: 3 }, text: 'A small scout.' });
  game.player.hand.add(first);
  game.player.hand.add(second);
  const attacker = new Card({ name: 'Guardian', type: 'ally', data: { attack: 3, health: 5 } });
  attacker.owner = game.player;
  game.player.battlefield.cards.push(attacker);
  const defender = new Card({ name: 'Enemy Guard', type: 'ally', data: { attack: 2, health: 4 }, keywords: ['Taunt'] });
  defender.owner = game.opponent;
  game.opponent.battlefield.cards.push(defender);
  game.opponent.hand.add(new Card({ id: 'SECRET-HAND-ID', name: 'SECRET HAND NAME', type: 'spell' }));
  game.opponent.library.cards.push(new Card({ id: 'SECRET-DECK-ID', name: 'SECRET DECK NAME', type: 'spell' }));
  game.opponent.hero.data.secrets = [{ cardId: 'SECRET-TRAP-ID', name: 'SECRET TRAP NAME' }];
  const state = createDecisionState({ game, player: game.player, opponent: game.opponent,
    pool: game.resources.pool(game.player), turn: game.turns.turn });
  return { game, state, actions: getLegalActions(state), first, second, attacker, defender };
}

function expectPlain(value) {
  if (value === null || typeof value !== 'object') {
    expect(typeof value).not.toBe('function');
    return;
  }
  expect(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype).toBe(true);
  for (const child of Object.values(value)) expectPlain(child);
}

test('default state has own hand and public opponent counts without hidden identities', () => {
  const { state, actions } = decision();
  const result = serializeDecisionState(state, { legalActions: actions });
  expect(result.player.hand.map(card => card.name)).toEqual(['Scout', 'Scout']);
  expect(serializeDecisionState(state).player.hero.heroPowerAvailable).toBe(true);
  expect(result.opponent.handCount).toBe(1);
  expect(result.opponent.libraryCount).toBe(1);
  expect(result.opponent.hero.secretCount).toBe(1);
  expect(result.player.board[0]).toMatchObject({ canAttack: true, attacksRemaining: 1, frozen: false });
  expect(result.opponent.board[0]).toMatchObject({ keywords: ['Taunt'], frozen: false });
  expect(result.opponent.board[0].canAttack).toBeUndefined();
  const json = JSON.stringify(result);
  for (const secret of ['SECRET-HAND-ID', 'SECRET HAND NAME', 'SECRET-DECK-ID',
    'SECRET DECK NAME', 'SECRET-TRAP-ID', 'SECRET TRAP NAME']) {
    expect(json).not.toContain(secret);
  }
  expect(result.opponent.hand).toBeUndefined();
  expect(result.player.library).toBeUndefined();
  expect(result.player.graveyard).toBeUndefined();
  expectPlain(result);
});

test('perfect information requires explicit opt-in and still omits deck order', () => {
  const { state } = decision();
  const result = serializeDecisionState(state, { informationMode: 'perfect' });
  expect(result.opponent.hand[0].id).toBe('SECRET-HAND-ID');
  expect(JSON.stringify(result)).not.toContain('SECRET-DECK-ID');
  expect(() => serializeDecisionState(state, { informationMode: 'invalid' })).toThrow(RangeError);
});

test('action IDs are stable and resolve exact canonical objects, including duplicate cards', () => {
  const { state, actions, first, second } = decision();
  const mapping = serializeLegalActions(actions, state);
  expect(mapping.actions.map(action => action.id)).toEqual(actions.map((_, index) => `a${index}`));
  expect(new Set(mapping.actions.map(action => action.id)).size).toBe(actions.length);
  actions.forEach((action, index) => expect(mapping.resolveAction(`a${index}`)).toBe(action));
  expect(mapping.resolveAction('missing')).toBeNull();
  const duplicateActions = actions.filter(action => action.card === first || action.card === second);
  expect(duplicateActions.length).toBeGreaterThanOrEqual(2);
  expect(mapping.resolveAction(mapping.actions[actions.indexOf(duplicateActions[0])].id))
    .not.toBe(mapping.resolveAction(mapping.actions[actions.indexOf(duplicateActions.at(-1))].id));
  expect(mapping.actions.some(action => action.description.includes('Play Scout'))).toBe(true);
  expect(mapping.actions.some(action => action.type === 'attack'
    && action.description.includes('Guardian') && action.description.includes('Enemy Guard'))).toBe(true);
  expect(mapping.actions.some(action => action.type === 'hero-power'
    && action.description.includes('Insight'))).toBe(true);
  expect(mapping.actions.at(-1)).toEqual({ id: `a${actions.length - 1}`, type: 'end-turn', description: 'End turn' });
});

test('payload is JSON-safe, deterministic, and does not mutate engine objects', () => {
  const { state, actions, first, attacker } = decision();
  const originalText = first.text;
  const originalHealth = attacker.data.health;
  const firstPayload = createRemoteDecisionPayload(state, actions);
  const secondPayload = createRemoteDecisionPayload(state, actions);
  expect(JSON.stringify(firstPayload.payload)).toBe(JSON.stringify(secondPayload.payload));
  expect(JSON.stringify(firstPayload.payload)).not.toContain('SECRET-HAND-ID');
  expect(JSON.stringify(firstPayload.payload)).not.toContain('SECRET-DECK-ID');
  expectPlain(firstPayload.payload);
  expect(firstPayload.resolveAction('a0')).toBe(actions[0]);
  expect(first.text).toBe(originalText);
  expect(attacker.data.health).toBe(originalHealth);
  expect(actions[0].card).toBeNull();
  expect(serializeCard({ name: 'No text', type: 'spell', effects: [{ type: 'damage', amount: 3, target: 'character' }] }).effects)
    .toEqual(['Deal 3 damage to character']);
});
