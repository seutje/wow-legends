import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import BasicAI from '../src/js/systems/ai.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

function containsCard(zone, id) {
  return zone.cards.some(c => c?.id === id);
}

test('AI trades a smaller ally into a dangerous threat', () => {
  const g = new Game();
  const ai = new BasicAI({ resourceSystem: g.resources, combatSystem: g.combat });

  g.turns.turn = 5;
  g.player.library.cards = [];
  g.opponent.library.cards = [];

  const threat = new Card({ name: 'Sinister Ravager', type: 'ally', data: { attack: 5, health: 2 } });
  const fodder = new Card({ name: 'Loyal Grunt', type: 'ally', data: { attack: 2, health: 2 } });

  threat.owner = g.opponent;
  fodder.owner = g.player;
  fodder.data.attacked = false;
  threat.data.attacked = false;

  g.player.battlefield.cards = [fodder];
  g.opponent.battlefield.cards = [threat];

  const startingEnemyHealth = g.opponent.hero.data.health;

  g.turns.setActivePlayer(g.player);
  ai.takeTurn(g.player, g.opponent);

  expect(containsCard(g.opponent.graveyard, threat.id)).toBe(true);
  expect(containsCard(g.player.graveyard, fodder.id)).toBe(true);
  expect(containsCard(g.opponent.battlefield, threat.id)).toBe(false);
  expect(g.opponent.hero.data.health).toBe(startingEnemyHealth);
});

test('MCTS AI trades a smaller ally into a dangerous threat', async () => {
  const g = new Game();
  const ai = new MCTS_AI({
    resourceSystem: g.resources,
    combatSystem: g.combat,
    iterations: 150,
    rolloutDepth: 3,
  });

  g.turns.turn = 5;
  g.player.library.cards = [];
  g.opponent.library.cards = [];

  const threat = new Card({ name: 'Sinister Ravager', type: 'ally', data: { attack: 5, health: 2 } });
  const fodder = new Card({ name: 'Loyal Grunt', type: 'ally', data: { attack: 2, health: 2 } });

  threat.owner = g.opponent;
  fodder.owner = g.player;
  fodder.data.attacked = false;
  threat.data.attacked = false;

  g.player.battlefield.cards = [fodder];
  g.opponent.battlefield.cards = [threat];

  const startingEnemyHealth = g.opponent.hero.data.health;

  g.turns.setActivePlayer(g.player);
  await ai.takeTurn(g.player, g.opponent);

  expect(containsCard(g.opponent.graveyard, threat.id)).toBe(true);
  expect(containsCard(g.player.graveyard, fodder.id)).toBe(true);
  expect(containsCard(g.opponent.battlefield, threat.id)).toBe(false);
  expect(g.opponent.hero.data.health).toBe(startingEnemyHealth);
});
