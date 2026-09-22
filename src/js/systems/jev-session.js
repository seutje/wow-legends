import RemoteDecisionAgent from './ai-remote.js';
import OpenRouterDecisionClient, { OpenRouterDecisionError } from './openrouter-decision-client.js';

// Browser-only credentials. Neither Game state nor save snapshots hold this object.
export class JevSession {
  #apiKey = '';
  #clientFactory;

  constructor({ clientFactory = options => new OpenRouterDecisionClient(options) } = {}) {
    this.#clientFactory = clientFactory;
    this.requestsThisSession = 0;
    this.requestsThisGame = 0;
    this.lastDecision = null;
    this.status = 'OpenRouter key required';
  }

  get configured() { return Boolean(this.#apiKey); }

  setKey(value) {
    let key = typeof value === 'string' ? value.trim() : '';
    // Accept a copied .env assignment as well as the bare key.
    if (/^(?:export\s+)?OPENROUTER_API_KEY\s*=/.test(key)) {
      key = key.replace(/^(?:export\s+)?OPENROUTER_API_KEY\s*=/, '').trim();
    }
    if ((key.startsWith('"') && key.endsWith('"'))
      || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
    this.#apiKey = key.trim();
    this.status = this.configured ? 'OpenRouter configured' : 'OpenRouter key required';
  }

  clearKey() { this.setKey(''); }

  resetGame() {
    this.requestsThisGame = 0;
    this.lastDecision = null;
  }

  createAgent({ onStatus = () => {}, onDecision = () => {} } = {}) {
    const client = { decide: async payload => {
      if (!this.configured) throw new OpenRouterDecisionError('OpenRouter API key is required',
        { code: 'missing_api_key' });
      this.status = `Jev is choosing from ${payload.actions.length} legal actions…`;
      onStatus(this.status);
      this.requestsThisGame += 1;
      this.requestsThisSession += 1;
      // Construct only at the decision point; clearing the key blocks the next request.
      try {
        const decision = await this.#clientFactory({ apiKey: this.#apiKey }).decide(payload);
        this.lastDecision = { actionId: decision.actionId, metadata: decision.metadata ?? null };
        return decision;
      } finally {
        this.status = this.configured ? 'OpenRouter configured' : 'OpenRouter key required';
        onStatus(this.status);
      }
    } };
    return new RemoteDecisionAgent({ client, onDecision });
  }
}

export default JevSession;
