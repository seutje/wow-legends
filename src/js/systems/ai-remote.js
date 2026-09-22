import { createRemoteDecisionPayload } from './ai-serialization.js';

// Client contract: async decide(plainJsonPayload) -> { actionId: string }.
// Invalid replies return null, so Game.runAgentTurn stops without executing an action.
export class RemoteDecisionAgent {
  constructor({ client, onDecision = null, serializationOptions = {} } = {}) {
    if (!client || typeof client.decide !== 'function') {
      throw new TypeError('RemoteDecisionAgent requires a client with decide(payload)');
    }
    this.client = client;
    this.onDecision = onDecision;
    this.serializationOptions = serializationOptions;
  }

  async chooseAction(state, actions) {
    const { payload, resolveAction } = createRemoteDecisionPayload(
      state, actions, this.serializationOptions,
    );
    const response = await this.client.decide(payload);
    if (!response || typeof response !== 'object' || typeof response.actionId !== 'string') return null;
    const action = resolveAction(response.actionId);
    if (!action) return null;
    if (typeof this.onDecision === 'function') {
      const actionType = payload.actions.find(item => item.id === response.actionId)?.type || 'unknown';
      try {
        this.onDecision({ actionId: response.actionId, actionType, metadata: response.metadata ?? null });
      } catch { /* diagnostics must not affect gameplay */ }
    }
    return action;
  }
}

const normalizeResponse = value => typeof value === 'string' ? { actionId: value } : value;

// Local deterministic client for tests and development. Script exhaustion and
// empty action lists return a missing ID, which the agent rejects safely.
export class MockDecisionClient {
  constructor({ strategy = 'first', responses = null, decide = null } = {}) {
    if (strategy !== 'first' && strategy !== 'end') {
      throw new RangeError(`Unknown mock decision strategy: ${strategy}`);
    }
    this.strategy = strategy;
    this.responses = Array.isArray(responses) ? [...responses] : null;
    this.callback = decide;
  }

  async decide(payload) {
    if (typeof this.callback === 'function') {
      return normalizeResponse(await this.callback(payload));
    }
    if (this.responses) {
      return this.responses.length ? normalizeResponse(this.responses.shift()) : { actionId: null };
    }
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    const selected = this.strategy === 'end'
      ? actions.find(action => action.type === 'end-turn')
      : actions[0];
    return { actionId: selected?.id ?? null };
  }
}

export default RemoteDecisionAgent;
