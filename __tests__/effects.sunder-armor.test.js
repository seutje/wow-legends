/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { EffectSystem } from '../src/js/systems/effects.js';
import Hero from '../src/js/entities/hero.js';

describe('Sunder Armor targeting', () => {
  test('enemy hero appears in targeting prompt for debuff', async () => {
    const game = {
      player: { name: 'P1' },
      opponent: { name: 'P2' },
      rng: { pick: (arr) => arr?.[0] },
      bus: { emit: jest.fn(), on: () => () => {} },
      turns: { bus: { on: () => () => {} } },
      CANCEL: Symbol('CANCEL'),
      // Capture candidates passed to promptTarget
      promptTarget: jest.fn(async (cands) => {
        // Pick the first friendly candidate so execution can proceed
        return cands.find(c => c?.name === 'Player Hero') || null;
      }),
    };

    const playerHero = new Hero({ name: 'Player Hero', data: { health: 30, armor: 0 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 30, armor: 2 } });

    game.player.hero = playerHero;
    game.opponent.hero = enemyHero;
    game.player.battlefield = { cards: [] };
    game.opponent.battlefield = { cards: [] };

    const effects = [
      { type: 'buff', target: 'character', property: 'armor', amount: -2 },
    ];

    const effectsSystem = new EffectSystem(game);

    await effectsSystem.execute(effects, { game, player: game.player, card: { name: 'Sunder Armor', type: 'spell' } });

    // Assert promptTarget was called and included enemy hero in candidates
    expect(game.promptTarget).toHaveBeenCalled();
    const candidates = game.promptTarget.mock.calls[0][0];
    const names = candidates.map(c => c.name);
    expect(names).toContain('Enemy Hero');
    const options = game.promptTarget.mock.calls[0][1] || {};
    expect(options.title).toBe('Apply -2 Armor');
  });
});

