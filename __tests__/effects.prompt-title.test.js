/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { EffectSystem } from '../src/js/systems/effects.js';

function createHero(name) {
  return {
    name,
    type: 'hero',
    data: { health: 30 },
  };
}

describe('target prompt titles', () => {
  test('damage prompt includes amount', async () => {
    const playerHero = createHero('Player Hero');
    const enemyHero = createHero('Enemy Hero');

    const player = {
      hero: playerHero,
      battlefield: { cards: [] },
      graveyard: { add: () => {} },
    };
    const opponent = {
      hero: enemyHero,
      battlefield: { cards: [] },
      graveyard: { add: () => {} },
    };

    const game = {
      player,
      opponent,
      CANCEL: Symbol('CANCEL'),
      promptTarget: jest.fn(async (candidates) => candidates[0] ?? null),
      bus: { emit: jest.fn(), on: jest.fn() },
      turns: { activePlayer: null, bus: { on: jest.fn(() => () => {}) } },
      cleanupDeaths: jest.fn(),
      checkForGameOver: jest.fn(),
    };

    player.opponent = opponent;
    opponent.opponent = player;

    const effects = new EffectSystem(game);
    const effect = { type: 'damage', target: 'any', amount: 3 };
    const context = { game, player, card: { name: 'Test Spell', type: 'spell' } };

    await effects.dealDamage(effect, context);

    expect(game.promptTarget).toHaveBeenCalled();
    const options = game.promptTarget.mock.calls[0][1] || {};
    expect(options.title).toBe('Deal 3 damage');
  });
});
