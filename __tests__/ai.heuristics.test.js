import Player from '../src/js/entities/player.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import Game from '../src/js/game.js';
import BasicAI from '../src/js/systems/ai.js';
import { evaluateGameState } from '../src/js/systems/ai-heuristics.js';

test('evaluateGameState favors stronger board', () => {
  const ai = new Player({ name: 'AI', hero: new Hero({ name: 'AI', data: { health: 10 } }) });
  const opponent = new Player({ name: 'OP', hero: new Hero({ name: 'OP', data: { health: 10 } }) });
  const turn = 1;
  const base = evaluateGameState({ player: ai, opponent, turn });
  const ally = new Card({ type: 'ally', name: 'Soldier', data: { attack: 1, health: 1 } });
  ai.battlefield.cards.push(ally);
  const improved = evaluateGameState({ player: ai, opponent, turn });
  expect(improved).toBeGreaterThan(base);
});

test('AI heals itself when injured', () => {
  const g = new Game();
  const ai = new BasicAI({ resourceSystem: g.resources, combatSystem: g.combat });
  g.turns.turn = 5;
  g.player.library.cards = [];
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 20;
  const potion = new Card({ type: 'consumable', name: 'Healing Potion', cost: 1, effects: [{ type: 'heal', target: 'character', amount: 5 }] });
  g.player.hand.add(potion);
  g.turns.setActivePlayer(g.player);
  ai.takeTurn(g.player, g.opponent);
  expect(g.player.hero.data.health).toBe(25);
  expect(g.player.graveyard.cards).toContain(potion);
});
