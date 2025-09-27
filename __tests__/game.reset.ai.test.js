import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('reset during AI turn swaps to new opponent hero for subsequent attacks', async () => {
  const game = new Game(null, { aiPlayers: [] });
  game.aiPlayers = new Set(['opponent']);

  const setupSpy = jest.spyOn(game, 'setupMatch').mockResolvedValue();

  const originalOpponentHero = game.opponent.hero;
  const originalHeroHealth = originalOpponentHero.data.health;

  const aiAlly = new Card({ name: 'AI Ally', type: 'ally', data: { attack: 3, health: 3 } });
  aiAlly.data.summoningSick = false;
  aiAlly.data.enteredTurn = 0;
  game.opponent.battlefield.cards = [aiAlly];
  game.opponent.hand.cards = [];

  game.turns.setActivePlayer(game.opponent);
  game.turns.startTurn();
  game.turns.current = 'Main';
  game.resources.startTurn(game.opponent);

  const throttleSpy = jest.spyOn(game, 'throttleAIAction');
  let releaseThrottle;
  throttleSpy
    .mockImplementationOnce(() => new Promise((resolve) => {
      releaseThrottle = () => {
        releaseThrottle = null;
        resolve();
      };
    }))
    .mockImplementation(() => Promise.resolve());

  const turnPromise = game._takeTurnWithDifficultyAI(game.opponent, game.player, 'easy');

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(typeof releaseThrottle).toBe('function');

  await game.reset();
  expect(setupSpy).toHaveBeenCalled();

  if (releaseThrottle) releaseThrottle();
  await turnPromise;
  throttleSpy.mockRestore();

  expect(game.state.aiThinking).toBe(false);
  expect(game.state.aiPending ?? null).toBeNull();

  const newOpponentHero = game.opponent.hero;
  expect(newOpponentHero).not.toBe(originalOpponentHero);

  const playerAlly = new Card({ name: 'Player Ally', type: 'ally', data: { attack: 4, health: 4 } });
  playerAlly.data.summoningSick = false;
  playerAlly.data.enteredTurn = 0;
  game.player.battlefield.cards = [playerAlly];

  game.turns.setActivePlayer(game.player);
  game.turns.startTurn();
  game.turns.current = 'Main';
  game.resources.startTurn(game.player);

  const beforeAttack = newOpponentHero.data.health;
  const result = await game.attack(game.player, playerAlly);
  expect(result).toBe(true);
  expect(newOpponentHero.data.health).toBe(beforeAttack - playerAlly.data.attack);
  expect(originalOpponentHero.data.health).toBe(originalHeroHealth);

  setupSpy.mockRestore();
});
