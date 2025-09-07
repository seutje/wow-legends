import { EventBus } from '../utils/events.js';

export const Phases = Object.freeze(['Start','Resource','Main','Combat','End']);

export class TurnSystem {
  constructor(bus = new EventBus()) {
    this.bus = bus;
    this.current = 'Start';
    this.turn = 1;
    this.activePlayer = null;
  }

  setActivePlayer(p) { this.activePlayer = p; }

  nextPhase() {
    const idx = Phases.indexOf(this.current);
    const next = (idx + 1) % Phases.length;
    if (next === 0) {
      this.turn += 1;
    }
    const prev = this.current;
    this.current = Phases[next];
    this.bus.emit('phase:end', { phase: prev, turn: this.turn });
    this.bus.emit('phase:start', { phase: this.current, turn: this.turn });
    return this.current;
  }

  startTurn() {
    this.current = 'Start';
    this.bus.emit('turn:start', { turn: this.turn, player: this.activePlayer });
    this.bus.emit('phase:start', { phase: this.current, turn: this.turn });
  }
}

export default TurnSystem;

