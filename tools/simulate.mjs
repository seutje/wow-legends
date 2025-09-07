#!/usr/bin/env node
import SkirmishMode from '../src/js/systems/modes/skirmish.js';

const sim = new SkirmishMode();
sim.setup();
let turns = 3;
while (turns--) {
  sim.aiTurn();
}
console.log('[simulate] Completed AI turns');

