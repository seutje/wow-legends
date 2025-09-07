// Orchestrates core game lifecycle. Minimal shell for now.

export default class Game {
  constructor(rootEl, opts = {}) {
    this.rootEl = rootEl;
    this.opts = opts;
    this.running = false;
    this._raf = 0;
    this._lastTs = 0;
    this.state = {
      frame: 0,
      startedAt: 0,
    };
  }

  init() {
    // Setup initial DOM/UI placeholders
    if (this.rootEl && !this.rootEl.dataset.bound) {
      this.rootEl.innerHTML = '<p>Game initialized. Press Start.</p>';
      this.rootEl.dataset.bound = '1';
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.state.startedAt = performance.now();
    this._lastTs = performance.now();
    const loop = (ts) => {
      if (!this.running) return;
      const dt = (ts - this._lastTs) / 1000;
      this._lastTs = ts;
      try { this.update(dt); } catch (e) { console.error(e); }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  update(dt) {
    // Placeholder: advance a simple counter; render it
    this.state.frame++;
    if (this.rootEl) {
      this.rootEl.textContent = `Running… frame ${this.state.frame} (+${dt.toFixed(3)}s)`;
    }
  }

  reset() {
    this.state.frame = 0;
    this.state.startedAt = 0;
    if (this.rootEl) this.rootEl.textContent = 'Reset.';
  }

  dispose() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.rootEl) this.rootEl.textContent = 'Disposed.';
  }
}

