import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

test('MCTS AI respects Rush restriction on hero attacks', async () => {
  const game = new Game();
  const ai = new MCTS_AI({
    resourceSystem: game.resources,
    combatSystem: game.combat,
    game,
    iterations: 50,
    rolloutDepth: 2,
  });

  game.turns.turn = 5;
  game.turns.setActivePlayer(game.opponent);

  game.opponent.hero.active = [];
  game.opponent.hand.cards = [];
  game.opponent.library.cards = [];
  game.opponent.log = [];

  const rushAlly = new Card({
    id: 'ai-test-rush',
    type: 'ally',
    name: 'AI Rush Ally',
    keywords: ['Rush'],
    cost: 3,
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
  const rushAttacks = game.opponent.log.filter(entry => entry.includes('with AI Rush Ally'));
  expect(rushAttacks).toHaveLength(0);
});
