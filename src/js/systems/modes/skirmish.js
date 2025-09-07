import Player from '../../entities/player.js';
import TurnSystem from '../../systems/turns.js';
import ResourceSystem from '../../systems/resources.js';
import BasicAI from '../../systems/ai.js';

export class SkirmishMode {
  constructor({ seed = 1 } = {}) {
    this.turns = new TurnSystem();
    this.resources = new ResourceSystem();
    this.ai = new BasicAI({ resourceSystem: this.resources });
    this.player = new Player({ name: 'Player' });
    this.opponent = new Player({ name: 'AI' });
  }

  setup() {
    this.turns.setActivePlayer(this.player);
    this.turns.startTurn();
    this.resources.startTurn(this.player);
  }

  playerTurn() {
    // Placeholder: player does nothing by default
    return true;
  }

  aiTurn() {
    this.turns.setActivePlayer(this.opponent);
    this.turns.startTurn();
    return this.ai.takeTurn(this.opponent);
  }
}

export default SkirmishMode;

