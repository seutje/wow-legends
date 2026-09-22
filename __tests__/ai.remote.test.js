import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import { createDecisionState, getLegalActions } from '../src/js/systems/ai-actions.js';
import RemoteDecisionAgent, { MockDecisionClient } from '../src/js/systems/ai-remote.js';

function setup() {
  const game = new Game();
  game.turns.turn = 3;
  game.turns.setActivePlayer(game.player);
  game.resources.startTurn(game.player);
  const state = createDecisionState({ game, player: game.player, opponent: game.opponent,
    pool: game.resources.pool(game.player), turn: game.turns.turn });
  return { game, state };
}

function expectPlain(value) {
  if (value === null || typeof value !== 'object') {
    expect(typeof value).not.toBe('function');
    return;
  }
  expect(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype).toBe(true);
  for (const child of Object.values(value)) expectPlain(child);
}

test('mock client supports first, end, scripted IDs, callbacks, and empty lists', async () => {
  const payload = { actions: [
    { id: 'a0', type: 'play-card' }, { id: 'a1', type: 'end-turn' },
  ] };
  expect(await new MockDecisionClient().decide(payload)).toEqual({ actionId: 'a0' });
  expect(await new MockDecisionClient({ strategy: 'end' }).decide(payload)).toEqual({ actionId: 'a1' });
  const scripted = new MockDecisionClient({ responses: ['a1', 'a0'] });
  expect(await scripted.decide(payload)).toEqual({ actionId: 'a1' });
  expect(await scripted.decide(payload)).toEqual({ actionId: 'a0' });
  expect(await scripted.decide(payload)).toEqual({ actionId: null });
  const callback = new MockDecisionClient({ decide: data => data.actions.find(a => a.type === 'end-turn').id });
  expect(await callback.decide(payload)).toEqual({ actionId: 'a1' });
  expect(await new MockDecisionClient().decide({ actions: [] })).toEqual({ actionId: null });
  expect(await new MockDecisionClient({ strategy: 'end' }).decide({ actions: [] })).toEqual({ actionId: null });
});

test('agent sends only serialized JSON and resolves the exact action despite duplicate descriptions', async () => {
  const { game, state } = setup();
  const first = new Card({ id: 'same', name: 'Scout', type: 'ally', cost: 0 });
  const second = new Card({ id: 'same', name: 'Scout', type: 'ally', cost: 0 });
  game.player.hand.add(first);
  game.player.hand.add(second);
  game.opponent.hand.add(new Card({ id: 'HIDDEN-CARD', name: 'Secret Card', type: 'spell' }));
  const actions = getLegalActions(state);
  const desired = actions.find(action => action.card === second && !action.usePower);
  const originalCount = game.player.hand.cards.length;
  const diagnostics = jest.fn();
  const client = { decide: jest.fn(async payload => {
    expectPlain(payload);
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.stringify(payload)).not.toContain('HIDDEN-CARD');
    expect(payload.state.opponent.handCount).toBe(1);
    const playIds = payload.actions.filter(action => action.type === 'play-card').map(action => action.id);
    expect(playIds).toHaveLength(2);
    payload.actions.forEach(action => { action.description = 'same description'; });
    return { actionId: playIds[1], metadata: { reason: 'test' } };
  }) };
  const agent = new RemoteDecisionAgent({ client, onDecision: diagnostics });
  expect(await agent.chooseAction(state, actions)).toBe(desired);
  expect(client.decide).toHaveBeenCalledTimes(1);
  expect(diagnostics).toHaveBeenCalledWith({ actionId: expect.any(String),
    actionType: 'play-card', metadata: { reason: 'test' } });
  expect(game.player.hand.cards).toHaveLength(originalCount);
  expect(actions.find(action => action.card === second)).toBe(desired);
});

test.each([null, undefined, {}, { actionId: null }, { actionId: 123 }, { actionId: 'missing' }])(
  'agent safely rejects invalid response %p', async response => {
    const { state } = setup();
    const actions = getLegalActions(state);
    const agent = new RemoteDecisionAgent({ client: { decide: async () => response } });
    expect(await agent.chooseAction(state, actions)).toBeNull();
  },
);

test('invalid scripted IDs cannot bypass the local resolver', async () => {
  const { state } = setup();
  const agent = new RemoteDecisionAgent({ client: new MockDecisionClient({ responses: ['a999'] }) });
  expect(await agent.chooseAction(state, getLegalActions(state))).toBeNull();
});

test('remote-style agent plays a complete turn through serialized IDs', async () => {
  const { game } = setup();
  const charger = new Card({ name: 'Swift Raider', type: 'ally', cost: 0, keywords: ['Charge'],
    data: { attack: 3, health: 2 } });
  game.player.hand.add(charger);
  const seen = [];
  const client = new MockDecisionClient({ decide: async payload => {
    expectPlain(payload);
    seen.push(payload);
    if (seen.length === 1) return payload.actions.find(action => action.type === 'play-card').id;
    if (seen.length === 2) return payload.actions.find(action => action.type === 'attack').id;
    return payload.actions.find(action => action.type === 'end-turn').id;
  } });
  const agent = new RemoteDecisionAgent({ client });
  const before = game.opponent.hero.data.health;
  expect(await game.runAgentTurn({ agent, player: game.player, opponent: game.opponent, skipStart: true })).toBe(true);
  expect(game.player.hand.cards).not.toContain(charger);
  expect(game.player.battlefield.cards).toContain(charger);
  expect(game.opponent.hero.data.health).toBe(before - 3);
  expect(seen).toHaveLength(3);
  expect(seen[1].state.player.board.some(card => card.name === 'Swift Raider')).toBe(true);
});

test('game turn loop awaits a delayed local decision client', async () => {
  const { game } = setup();
  const client = { decide: jest.fn(async payload => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return { actionId: payload.actions.find(action => action.type === 'end-turn').id };
  }) };
  const agent = new RemoteDecisionAgent({ client });
  expect(await game.runAgentTurn({ agent, player: game.player, opponent: game.opponent, skipStart: true })).toBe(true);
  expect(client.decide).toHaveBeenCalledTimes(1);
});
