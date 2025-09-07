#!/usr/bin/env node
// Run simple simulations across seeds and print a trivial report
import SkirmishMode from '../src/js/systems/modes/skirmish.js';

function run(seed) {
  const s = new SkirmishMode({ seed });
  s.setup();
  for (let i = 0; i < 5; i++) s.aiTurn();
  return { seed, aiResources: s.opponent.resourcesZone.size() };
}

const seeds = [1,2,3,4,5];
const results = seeds.map(run);
const avgResources = results.reduce((s,r)=>s+r.aiResources,0)/results.length;
const report = { avgResources, results };
console.log(JSON.stringify(report, null, 2));

