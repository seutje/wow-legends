import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import NeuralAI from '../src/js/systems/ai-nn.js';

it('prevents NeuralAI from attacking the hero with rush allies on their entry turn', async () => {
  const game = new Game();
  const ai = new NeuralAI({ game, resourceSystem: game.resources, combatSystem: game.combat });

  game.turns.turn = 6;
  game.turns.setActivePlayer(game.opponent);

  game.opponent.hero.active = [];
  game.opponent.hand.cards = [];
  game.opponent.library.cards = [];
  game.opponent.log = [];

  const rushAlly = new Card({
    id: 'ally-test-rush',
    type: 'ally',
    name: 'Test Rush Ally',
    keywords: ['Rush'],
    data: {
      attack: 4,
      health: 4,
      maxHealth: 4,
      enteredTurn: game.turns.turn,
      summoningSick: false,
      attacked: false,
      attacksUsed: 0,
    },
  });
  rushAlly.owner = game.opponent;

  game.opponent.battlefield.cards = [rushAlly];
  game.player.battlefield.cards = [];

  game.player.hero.data.maxHealth = 30;
  game.player.hero.data.health = 18;
  game.player.hero.data.armor = 0;

  await ai.takeTurn(game.opponent, game.player);

  expect(game.player.hero.data.health).toBe(18);
  expect(rushAlly.data.attacksUsed || 0).toBe(0);
  const rushAttacks = game.opponent.log.filter(entry => entry.includes('with Test Rush Ally'));
  expect(rushAttacks).toHaveLength(0);
});
