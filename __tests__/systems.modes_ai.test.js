import SkirmishMode from '../src/js/systems/modes/skirmish.js';
import { Ragnaros } from '../src/js/systems/encounter.js';

describe('Game Modes & AI', () => {
  test('AI turn completes quickly', () => {
    const s = new SkirmishMode();
    s.setup();
    const ok = s.aiTurn();
    expect(ok).toBe(true);
  });

  test('Encounter script runs and affects players', () => {
    const s = new SkirmishMode();
    s.setup();
    s.player.hero.data.health = 5;
    const rag = new Ragnaros();
    rag.onTurn({ players: [s.player] });
    expect(s.player.hero.data.health).toBe(3);
  });
});

