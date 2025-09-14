import { EffectSystem } from '../src/js/systems/effects.js';
import Hero from '../src/js/entities/hero.js';

describe('Armor never goes negative', () => {
  test('debuff does not drop armor below zero', async () => {
    const game = {
      player: {},
      opponent: {},
      rng: { pick: (arr) => arr?.[0] },
      bus: { emit: () => {}, on: () => () => {} },
      turns: { bus: { on: () => () => {} } },
      promptTarget: async (cands) => cands[0],
      CANCEL: Symbol('CANCEL'),
    };

    const playerHero = new Hero({ name: 'Player', data: { health: 30, armor: 1 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30, armor: 0 } });
    game.player.hero = playerHero;
    game.opponent.hero = enemyHero;
    game.player.battlefield = { cards: [] };
    game.opponent.battlefield = { cards: [] };

    const effects = [
      { type: 'buff', target: 'character', property: 'armor', amount: -2 },
    ];

    const effectsSystem = new EffectSystem(game);
    await effectsSystem.execute(effects, { game, player: game.player, card: { name: 'Sunder Armor', type: 'spell' } });

    expect(playerHero.data.armor).toBe(0);
  });
});

