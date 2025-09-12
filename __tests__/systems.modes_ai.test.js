import SkirmishMode from '../src/js/systems/modes/skirmish.js';
import { Ragnaros } from '../src/js/systems/encounter.js';
import Card from '../src/js/entities/card.js';
import Hero from '../src/js/entities/hero.js';

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

  test('AI uses hero power, plays a card, and attacks', () => {
    const s = new SkirmishMode();
    s.setup();
    s.turns.turn = 2; // ensure 2 resources for hero power
    s.opponent.hero = new Hero({
      name: 'AI Hero',
      data: { attack: 1 },
      active: [{ type: 'damage', amount: 1 }],
    });
    const ally = new Card({ type: 'ally', name: 'Grunt', cost: 0, data: { attack: 1, health: 1 } });
    s.opponent.hand.add(ally);
    const initialHealth = s.player.hero.data.health;
    const ok = s.aiTurn();
    expect(ok).toBe(true);
    expect(s.opponent.hero.powerUsed).toBe(true);
    expect(s.opponent.battlefield.cards).toContain(ally);
    expect(s.player.hero.data.health).toBeLessThan(initialHealth);
  });
});

