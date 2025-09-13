// MCTS Web Worker: performs the heavy search off the main thread
// It imports the existing MCTS implementation and invokes its internal search.
import MCTS_AI from '../systems/ai-mcts.js';

self.onmessage = (ev) => {
  const { cmd, rootState, iterations, rolloutDepth, turn } = ev.data || {};
  if (cmd !== 'search') return;
  try {
    // Provide a minimal resource system context for effects that depend on turn count
    const resourceShim = { turns: { turn } };
    const ai = new MCTS_AI({ resourceSystem: resourceShim, iterations, rolloutDepth });
    // Intentionally call the synchronous search to avoid nested workers
    const action = ai._search(rootState);
    self.postMessage({ ok: true, action });
  } catch (err) {
    // In case of any error, respond with failure; caller can fallback
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};

