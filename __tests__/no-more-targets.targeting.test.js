import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('multi-target prompts allow early completion after first pick', async () => {
  const g = new Game();
  const player = g.player;
  const enemy1 = new Card({ name: 'E1', type: 'ally', data: { attack: 0, health: 2 }, keywords: [] });
  const enemy2 = new Card({ name: 'E2', type: 'ally', data: { attack: 0, health: 2 }, keywords: [] });
  g.opponent.battlefield.add(enemy1);
  g.opponent.battlefield.add(enemy2);

  const promptSpy = jest
    .fn()
    .mockResolvedValueOnce(enemy1)
    .mockResolvedValueOnce(null);
  g.promptTarget = promptSpy;

  await g.effects.dealDamage(
    { target: 'upToThreeTargets', amount: 1 },
    { game: g, player, card: null }
  );

  expect(promptSpy).toHaveBeenCalledTimes(2);
  expect(promptSpy.mock.calls[0][1]).toMatchObject({ allowNoMore: false, preferredSide: 'enemy' });
  expect(promptSpy.mock.calls[0][1].actingPlayer).toBe(player);
  expect(promptSpy.mock.calls[1][1]).toMatchObject({ allowNoMore: true, preferredSide: 'enemy' });
  expect(promptSpy.mock.calls[1][1].actingPlayer).toBe(player);
  expect(enemy1.data.health).toBe(1);
  expect(enemy2.data.health).toBe(2);
});
