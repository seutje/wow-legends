import { jest } from '@jest/globals';
import JevSession from '../src/js/systems/jev-session.js';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import { captureGameState } from '../src/js/utils/savegame.js';
import { serializeDecisionState } from '../src/js/systems/ai-serialization.js';
import { createDecisionState } from '../src/js/systems/ai-actions.js';

const fakeKey = 'fake-openrouter-secret-key';
const setup = () => {
  const game = new Game();
  game.state.opponentAgent = 'jev';
  game.turns.turn = 3;
  game.turns.setActivePlayer(game.opponent);
  game.resources.startTurn(game.opponent);
  return game;
};

test('credentials stay outside settings, game state, and remote payload; clear blocks decisions', async () => {
  const requests = [];
  const session = new JevSession({ clientFactory: options => {
    expect(options.apiKey).toBe(fakeKey);
    return { decide: async payload => {
      requests.push(payload);
      return { actionId: payload.actions.find(a => a.type === 'end-turn').id };
    } };
  } });
  const game = setup();
  expect(session.configured).toBe(false);
  session.setKey(` ${fakeKey} `);
  game.opponentAgentFactory = () => session.createAgent();
  expect(await game._executeOpponentTurn({ skipSetup: true })).toBe(true);
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(captureGameState(game))).not.toContain(fakeKey);
  expect(JSON.stringify(game.state)).not.toContain(fakeKey);
  expect(JSON.stringify(requests[0])).not.toContain(fakeKey);
  const state = createDecisionState({ game, player: game.opponent, opponent: game.player,
    pool: 0, turn: game.turns.turn });
  expect(JSON.stringify(serializeDecisionState(state))).not.toContain(fakeKey);
  session.clearKey();
  expect(session.configured).toBe(false);
  await expect(session.createAgent().client.decide(requests[0])).rejects.toMatchObject({ code: 'missing_api_key' });
  expect(requests).toHaveLength(1);
  expect(new JevSession().configured).toBe(false);
});

test('Jev makes sequential card, attack, and end-turn choices through canonical actions', async () => {
  const game = setup();
  game.opponent.hand.add(new Card({ name: 'Swift Raider', type: 'ally', cost: 0,
    keywords: ['Charge'], data: { attack: 3, health: 2 } }));
  const seen = [];
  const session = new JevSession({ clientFactory: () => ({ decide: async payload => {
    seen.push(payload.actions.map(a => a.type));
    const type = seen.length === 1 ? 'play-card' : seen.length === 2 ? 'attack' : 'end-turn';
    return { actionId: payload.actions.find(a => a.type === type).id,
      metadata: { provider: 'openrouter', probabilities: {} } };
  } }) });
  session.setKey(fakeKey);
  game.opponentAgentFactory = () => session.createAgent({ onDecision: event => game.bus.emit('ai:decision', event) });
  const events = [];
  game.bus.on('ai:decision', event => events.push(event));
  const before = game.player.hero.data.health;
  expect(await game._executeOpponentTurn({ skipSetup: true })).toBe(true);
  expect(game.player.hero.data.health).toBe(before - 3);
  expect(seen).toHaveLength(3);
  expect(seen[1]).toContain('attack');
  expect(session.requestsThisGame).toBe(3);
  expect(events).toHaveLength(3);
  expect(game.turns.activePlayer).toBe(game.player);
});

test('failure stops safely, explicit retry resumes, and local AI remains selectable', async () => {
  const game = setup();
  let calls = 0;
  const session = new JevSession({ clientFactory: () => ({ decide: async payload => {
    calls++;
    if (calls === 1) { const error = new Error('no network'); error.code = 'network_failure'; throw error; }
    return { actionId: payload.actions.find(a => a.type === 'end-turn').id };
  } }) });
  session.setKey(fakeKey);
  game.opponentAgentFactory = () => session.createAgent();
  expect(await game._executeOpponentTurn({ skipSetup: true })).toBe(false);
  expect(game.agentFailure).toBe('network_failure');
  expect(game.turns.activePlayer).toBe(game.opponent);
  expect(calls).toBe(1);
  expect(await game.retryOpponentAgentTurn()).toBe(true);
  expect(calls).toBe(2);
  expect(game.agentFailure).toBeNull();
  game.state.opponentAgent = 'local';
  const local = jest.spyOn(game, '_takeTurnWithDifficultyAI').mockResolvedValue();
  game.turns.setActivePlayer(game.opponent);
  expect(await game._executeOpponentTurn({ skipSetup: true })).toBe(true);
  expect(local).toHaveBeenCalledTimes(1);
});

test('in-flight opponent request cannot be duplicated', async () => {
  const game = setup();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const decide = jest.fn(async payload => { await pending; return { actionId: payload.actions.find(a => a.type === 'end-turn').id }; });
  const session = new JevSession({ clientFactory: () => ({ decide }) });
  session.setKey(fakeKey);
  game.opponentAgentFactory = () => session.createAgent();
  const first = game._executeOpponentTurn({ skipSetup: true });
  await Promise.resolve();
  expect(await game._executeOpponentTurn({ skipSetup: true })).toBe(false);
  release();
  await first;
  expect(decide).toHaveBeenCalledTimes(1);
});

test('game over stops Jev before another paid request', async () => {
  const game = setup();
  game.player.hero.data.health = 2;
  game.opponent.hand.add(new Card({ name: 'Swift Raider', type: 'ally', cost: 0,
    keywords: ['Charge'], data: { attack: 3, health: 2 } }));
  const decide = jest.fn(async payload => ({ actionId: payload.actions.find(a =>
    a.type === (decide.mock.calls.length === 1 ? 'play-card' : 'attack')).id }));
  const session = new JevSession({ clientFactory: () => ({ decide }) });
  session.setKey(fakeKey);
  game.opponentAgentFactory = () => session.createAgent();
  await game._executeOpponentTurn({ skipSetup: true });
  expect(game.isGameOver()).toBe(true);
  expect(decide).toHaveBeenCalledTimes(2);
});

test('clearing a key during a turn blocks the next decision', async () => {
  const game = setup();
  game.opponent.hand.add(new Card({ name: 'Scout', type: 'ally', cost: 0,
    data: { attack: 1, health: 1 } }));
  const session = new JevSession({ clientFactory: () => ({ decide: async payload => {
    session.clearKey();
    return { actionId: payload.actions.find(a => a.type === 'play-card').id };
  } }) });
  session.setKey(fakeKey);
  game.opponentAgentFactory = () => session.createAgent();
  expect(await game._executeOpponentTurn({ skipSetup: true })).toBe(false);
  expect(game.agentFailure).toBe('missing_api_key');
  expect(session.requestsThisGame).toBe(1);
});

test.each([
  'OPENROUTER_API_KEY=fake-openrouter-secret-key',
  'export OPENROUTER_API_KEY="fake-openrouter-secret-key"',
  "'fake-openrouter-secret-key'",
])('accepts a copied env value without changing the credential', async pasted => {
  const session = new JevSession({ clientFactory: options => {
    expect(options.apiKey).toBe(fakeKey);
    return { decide: async payload => ({ actionId: payload.actions[0].id }) };
  } });
  session.setKey(pasted);
  await expect(session.createAgent().client.decide({ actions: [{ id: 'a0' }] }))
    .resolves.toEqual({ actionId: 'a0' });
});

