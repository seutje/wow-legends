import { jest } from '@jest/globals';
import OpenRouterDecisionClient from '../src/js/systems/openrouter-decision-client.js';
import RemoteDecisionAgent from '../src/js/systems/ai-remote.js';

const payload = { state: { turn: 2, player: { hero: { health: 20 } } }, actions: [
  { id: 'a0', type: 'end-turn', description: 'End turn' },
  { id: 'a1', type: 'attack', description: 'Attack enemy hero' },
] };
const success = { model: 'typesafe/jev-1.13', id: 'req-1', usage: { input_tokens: 12, cost: 0.01 },
  answers: { action: { type: 'choice', choice: 'a1', probabilities: { a0: 0.2, a1: 0.8 }, confidence: 0.8 } } };
const mockResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => body });

test('constructs a native Jev choice request with only legal actions and a secret header', async () => {
  const fetchImpl = jest.fn(async () => mockResponse(success));
  const client = new OpenRouterDecisionClient({ apiKey: 'fake-secret', fetchImpl });
  const result = await client.decide(payload);
  const [url, request] = fetchImpl.mock.calls[0];
  const body = JSON.parse(request.body);
  expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
  expect(request.headers.Authorization).toBe('Bearer fake-secret');
  expect(request.body).not.toContain('fake-secret');
  expect(body.model).toBe('~typesafe/jev-latest');
  expect(body.state.game).toEqual(payload.state);
  expect(body.state.actions).toEqual(payload.actions);
  expect(Object.keys(body.questions.action.criteria)).toEqual(['a0', 'a1']);
  expect(body.questions.action.instructions).toMatch(/probability of ultimately winning/);
  expect(result).toMatchObject({ actionId: 'a1', metadata: { provider: 'openrouter',
    model: 'typesafe/jev-1.13', requestId: 'req-1', probabilities: { a0: 0.2, a1: 0.8 },
    usage: { input_tokens: 12, cost: 0.01 } } });
});

test.each([
  [{ answers: { action: { choice: 'a9' } } }, 'invalid_action'],
  [{ answers: {} }, 'missing_decision'],
  [{}, 'missing_decision'],
  [null, 'malformed_response'],
])('rejects invalid decision response', async (body, code) => {
  const client = new OpenRouterDecisionClient({ apiKey: 'fake-secret',
    fetchImpl: async () => mockResponse(body) });
  await expect(client.decide(payload)).rejects.toMatchObject({ code });
});

test.each([[401, 'authentication'], [403, 'forbidden'], [402, 'insufficient_credits'],
  [429, 'rate_limit'], [500, 'provider_error']])('normalizes HTTP %i', async (status, code) => {
  const client = new OpenRouterDecisionClient({ apiKey: 'fake-secret',
    fetchImpl: async () => mockResponse({ error: { message: 'fake-secret' } }, status) });
  await expect(client.decide(payload)).rejects.toMatchObject({ status, code });
  await expect(client.decide(payload)).rejects.not.toThrow('fake-secret');
});

test('timeout aborts one request', async () => {
  const fetchImpl = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const client = new OpenRouterDecisionClient({ apiKey: 'fake-secret', timeoutMs: 5, fetchImpl });
  await expect(client.decide(payload)).rejects.toMatchObject({ code: 'timeout' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('generic remote agent accepts OpenRouter client without provider coupling', async () => {
  const client = new OpenRouterDecisionClient({ apiKey: 'fake-secret',
    fetchImpl: async () => mockResponse({ answers: { action: { choice: 'a0' } } }) });
  const agent = new RemoteDecisionAgent({ client });
  const action = { end: true };
  expect(await agent.chooseAction({ player: {}, opponent: {}, turn: 1, pool: 0 }, [action])).toBe(action);
});


test('default fetch keeps the browser global as its receiver', async () => {
  const original = globalThis.fetch;
  const fetchMock = jest.fn(function () {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(mockResponse(success));
  });
  globalThis.fetch = fetchMock;
  try {
    const client = new OpenRouterDecisionClient({ apiKey: 'fake-secret' });
    await expect(client.decide(payload)).resolves.toMatchObject({ actionId: 'a1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    globalThis.fetch = original;
  }
});
