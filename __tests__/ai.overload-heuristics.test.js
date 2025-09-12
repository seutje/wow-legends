import Player from '../src/js/entities/player.js';
import Hero from '../src/js/entities/hero.js';
import { evaluateGameState } from '../src/js/systems/ai-heuristics.js';

test('evaluateGameState penalizes pending overload on AI', () => {
  const ai = new Player({ name: 'AI', hero: new Hero({ name: 'AI', data: { health: 30 } }) });
  const opponent = new Player({ name: 'OP', hero: new Hero({ name: 'OP', data: { health: 30 } }) });
  const base = evaluateGameState({ player: ai, opponent, turn: 5, resources: 5 });
  const withOverload = evaluateGameState({ player: ai, opponent, turn: 5, resources: 5, overloadNextPlayer: 2 });
  expect(withOverload).toBeLessThan(base);
});

test('evaluateGameState rewards pending overload on opponent', () => {
  const ai = new Player({ name: 'AI', hero: new Hero({ name: 'AI', data: { health: 30 } }) });
  const opponent = new Player({ name: 'OP', hero: new Hero({ name: 'OP', data: { health: 30 } }) });
  const base = evaluateGameState({ player: ai, opponent, turn: 5, resources: 5 });
  const oppOverload = evaluateGameState({ player: ai, opponent, turn: 5, resources: 5, overloadNextOpponent: 2 });
  expect(oppOverload).toBeGreaterThan(base);
});

