import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import NeuralAI from '../src/js/systems/ai-nn.js';

it('allows NeuralAI allies with Windfury to attack twice', async () => {
  const game = new Game();
  const ai = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat });

  game.turns.turn = 5;
  game.turns.setActivePlayer(game.opponent);

  game.opponent.hero.active = [];
  game.opponent.hand.cards = [];

  const windfuryAlly = new Card({
    id: 'ally-test-windfury',
    type: 'ally',
    name: 'Test Windfury Ally',
    keywords: ['Windfury'],
    data: {
      attack: 3,
      health: 3,
      maxHealth: 3,
      enteredTurn: 0,
      attacked: false,
      attacksUsed: 0,
      summoningSick: false,
    },
  });
  windfuryAlly.owner = game.opponent;

  game.opponent.battlefield.cards = [windfuryAlly];

  game.player.hero.data.maxHealth = 30;
  game.player.hero.data.health = 12;
  game.player.hero.data.armor = 0;

  await ai.takeTurn(game.opponent, game.player);

  expect(game.player.hero.data.health).toBe(6);
  expect(windfuryAlly.data.attacksUsed).toBe(2);
  const attackLogs = game.opponent.log.filter(entry => entry.includes('with Test Windfury Ally'));
  expect(attackLogs).toHaveLength(2);
});
