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
    this.terminal = false;
    this.best = -Infinity;
    this.hasLethal = false;
  }
  ucb1(c = 1.4) {
    if (this.visits === 0) return Infinity;
    const mean = this.total / this.visits;
    const exploration = c * Math.sqrt(Math.log(this.parent.visits + 1) / this.visits);
    return mean + exploration;
  }
}

const backpropagate = (node, value, lethal = false) => {
  let current = node;
  while (current) {
    current.visits++;
    current.total += value;
    if (Number.isFinite(value) && value > current.best) current.best = value;
    if (lethal) current.hasLethal = true;
    current = current.parent;
  }
};

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
      while (!node.terminal && (node.untried === null ? false : node.untried.length === 0 && node.children.length)) {
        node = node.children.reduce((a, b) => (a.ucb1() > b.ucb1() ? a : b));
      }
      // Expansion
      if (node.terminal) {
        const denom = Math.max(1, node.visits);
        const value = node.visits > 0 ? (node.total / denom) : 0;
        const lethal = node.hasLethal || (Number.isFinite(value) && value >= ai._lethalThreshold);
        backpropagate(node, value, lethal);
        if (ai._shouldStopSearch(root)) break;
        continue;
      }
      if (node.untried === null) node.untried = ai._legalActions(node.state);
      if (node.untried.length) {
        const idx = Math.floor(Math.random() * node.untried.length);
        const action = node.untried.splice(idx, 1)[0];
        const res = ai._applyAction(node.state, action);
        if (res.terminal) {
          const value = res.value;
          const child = new WNode(null, node, action);
          child.visits = 1;
          child.total = value;
          child.terminal = true;
          child.state = null;
          child.untried = [];
          child.children = [];
          child.best = Number.isFinite(value) ? value : child.best;
          child.hasLethal = !!res.lethal;
          node.children.push(child);
          backpropagate(node, value, !!res.lethal);
          if (ai._shouldStopSearch(root)) break;
        } else {
          const child = new WNode(res.state, node, action);
          node.children.push(child);
          node = child;
          // Rollout
          const { value, lethal } = ai._randomPlayout(node.state);
          backpropagate(node, value, lethal);
          if (ai._shouldStopSearch(root)) break;
        }
      } else {
        // Rollout only
        const { value, lethal } = ai._randomPlayout(node.state);
        backpropagate(node, value, lethal);
        if (ai._shouldStopSearch(root)) break;
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
