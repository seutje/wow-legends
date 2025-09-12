import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import BasicAI from '../src/js/systems/ai.js';

test('AI does not attack with summoning-sick ally', () => {
  const g = new Game();
  const ai = new BasicAI({ resourceSystem: g.resources, combatSystem: g.combat });
  g.player.hero = new Hero({ name: 'AI', data: { health: 10 } });
  g.opponent.hero = new Hero({ name: 'Opponent', data: { health: 10 } });
  const ally = new Card({ type: 'ally', name: 'Footman', cost: 0, data: { attack: 1, health: 1 } });
  g.player.hand.add(ally);
  g.turns.setActivePlayer(g.player);
  g.turns.startTurn();
  ai.takeTurn(g.player, g.opponent);
  const played = g.player.battlefield.cards.find(c => c.name === 'Footman');
  expect(played.data.attacked).toBe(true);
  expect(g.opponent.hero.data.health).toBe(10);
});

