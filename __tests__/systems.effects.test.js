import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('EffectSystem', () => {
  test('dead allies move from battlefield to graveyard', async () => {
    const game = new Game();
    const player = game.player;
    const ally = new Card({ type: 'ally', name: 'A', data: { attack: 0, health: 1 } });
    player.battlefield.add(ally);

    await game.effects.dealDamage(
      { target: 'allCharacters', amount: 1 },
      { game, player, card: null }
    );

    expect(player.battlefield.cards.length).toBe(0);
    expect(player.graveyard.cards).toContain(ally);
  });

  test('dealDamage prompts for target and applies damage', async () => {
    const game = new Game();
    const player = game.player;
    const enemy = new Card({ type: 'ally', name: 'E', data: { attack: 0, health: 3 } });
    game.opponent.battlefield.add(enemy);

    const promptSpy = jest.fn(async () => enemy);
    game.promptTarget = promptSpy;

    await game.effects.dealDamage(
      { target: 'any', amount: 2 },
      { game, player, card: null }
    );

    expect(promptSpy).toHaveBeenCalled();
    expect(enemy.data.health).toBe(1);
  });
});

