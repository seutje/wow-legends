// MCTS Web Worker: performs the heavy search off the main thread
// It imports the existing MCTS implementation and invokes its internal search.
import MCTS_AI from '../systems/ai-mcts.js';

class WNode {
  constructor(state, parent = null, action = null) {
    this.state = state;
    this.parent = parent;
    this.action = action;
    this.children = [];
    this.untried = null;
    this.visits = 0;
    this.total = 0;
  }
  ucb1(c = 1.4) {
    if (this.visits === 0) return Infinity;
    const mean = this.total / this.visits;
    const exploration = c * Math.sqrt(Math.log(this.parent.visits + 1) / this.visits);
    return mean + exploration;
  }
}

self.onmessage = (ev) => {
  const { cmd, rootState, iterations, rolloutDepth, turn } = ev.data || {};
  if (cmd !== 'search') return;
  try {
    // Provide a minimal resource system context for effects that depend on turn count
    const resourceShim = { turns: { turn } };
    const ai = new MCTS_AI({ resourceSystem: resourceShim, iterations, rolloutDepth });

    // Incremental search with periodic progress posts
    const root = new WNode(ai._cloneState(rootState));
    const iters = Math.max(1, iterations || 1);
    for (let i = 0; i < iters; i++) {
      // Selection
      let node = root;
      while (node.untried === null ? false : node.untried.length === 0 && node.children.length) {
        node = node.children.reduce((a, b) => (a.ucb1() > b.ucb1() ? a : b));
      }
      // Expansion
      if (node.untried === null) node.untried = ai._legalActions(node.state);
      if (node.untried.length) {
        const idx = Math.floor(Math.random() * node.untried.length);
        const action = node.untried.splice(idx, 1)[0];
        const res = ai._applyAction(node.state, action);
        if (res.terminal) {
          const value = res.value;
          let n = node;
          while (n) { n.visits++; n.total += value; n = n.parent; }
        } else {
          const child = new WNode(res.state, node, action);
          node.children.push(child);
          node = child;
          // Rollout
          const value = ai._randomPlayout(node.state);
          while (node) { node.visits++; node.total += value; node = node.parent; }
        }
      } else {
        // Rollout only
        const value = ai._randomPlayout(node.state);
        while (node) { node.visits++; node.total += value; node = node.parent; }
      }
      if (i === 0 || (i % 100) === 0) {
        const progress = Math.min(1, i / iters);
        try { self.postMessage({ progress }); } catch {}
      }
    }
    // Choose best child
    let best = null; let bestVal = -Infinity;
    for (const ch of root.children) {
      const val = ch.visits === 0 ? -Infinity : (ch.total / ch.visits);
      if (val > bestVal) { bestVal = val; best = ch; }
    }
    const action = best?.action || { end: true };
    self.postMessage({ ok: true, action, progress: 1 });
  } catch (err) {
    // In case of any error, respond with failure; caller can fallback
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
