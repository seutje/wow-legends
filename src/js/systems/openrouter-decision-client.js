// A caller supplies the key at runtime. Never bundle a development key into browser code.
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_MODEL = '~typesafe/jev-latest';
const OBJECTIVE = "Choose the legal action that best improves the active player's probability of ultimately winning the game.";

export class OpenRouterDecisionError extends Error {
  constructor(message, { status = null, code = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OpenRouterDecisionError';
    this.status = status;
    this.code = code;
  }
}

export class OpenRouterDecisionClient {
  constructor({ apiKey, model = DEFAULT_MODEL, timeoutMs = 15000, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new OpenRouterDecisionError('OpenRouter API key is required', { code: 'missing_api_key' });
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async decide(payload) {
    const actions = payload?.actions;
    if (!Array.isArray(actions) || !actions.length || actions.some(a => !a || typeof a.id !== 'string')
      || new Set(actions.map(a => a.id)).size !== actions.length || !payload.state) {
      throw new OpenRouterDecisionError('Invalid remote decision payload', { code: 'invalid_payload' });
    }
    const allowed = new Set(actions.map(action => action.id));
    const body = {
      model: this.model,
      state: { game: payload.state, actions },
      questions: { action: {
        type: 'choice', instructions: OBJECTIVE,
        criteria: Object.fromEntries(actions.map(action => [action.id, action.description || action.type || action.id])),
      } },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    let response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const code = response.status === 401 ? 'authentication'
          : response.status === 403 ? 'forbidden'
            : response.status === 402 ? 'insufficient_credits'
            : response.status === 429 ? 'rate_limit' : 'provider_error';
        // Provider error text can echo request headers; keep errors safe and bounded.
        throw new OpenRouterDecisionError(`OpenRouter decision request failed (HTTP ${response.status})`,
          { status: response.status, code });
      }
      if (!data || typeof data !== 'object') {
        throw new OpenRouterDecisionError('Malformed OpenRouter decision response', { code: 'malformed_response' });
      }
      const answer = data.answers?.action;
      if (!answer || typeof answer.choice !== 'string') {
        throw new OpenRouterDecisionError('OpenRouter response has no action decision', { code: 'missing_decision' });
      }
      if (!allowed.has(answer.choice)) {
        throw new OpenRouterDecisionError('OpenRouter returned an action outside the legal set', { code: 'invalid_action' });
      }
      const metadata = { provider: 'openrouter', model: data.model || this.model,
        latencyMs: Date.now() - started };
      if (data.id) metadata.requestId = data.id;
      if (data.usage) metadata.usage = data.usage;
      if (data.provider) metadata.upstreamProvider = data.provider;
      if (typeof answer.confidence === 'number') metadata.confidence = answer.confidence;
      if (answer.probabilities && typeof answer.probabilities === 'object') {
        metadata.probabilities = Object.fromEntries(Object.entries(answer.probabilities)
          .filter(([id, probability]) => allowed.has(id) && typeof probability === 'number'
            && Number.isFinite(probability) && probability >= 0 && probability <= 1));
      }
      return { actionId: answer.choice, metadata };
    } catch (error) {
      if (error instanceof OpenRouterDecisionError) throw error;
      if (controller.signal.aborted) {
        throw new OpenRouterDecisionError(`OpenRouter decision timed out after ${this.timeoutMs}ms`,
          { code: 'timeout' });
      }
      throw new OpenRouterDecisionError('OpenRouter decision network failure', { code: 'network_failure' });
    } finally {
      clearTimeout(timer);
    }
  }
}

export default OpenRouterDecisionClient;
