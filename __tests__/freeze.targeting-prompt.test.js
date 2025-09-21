import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('frozen attackers do not trigger the target selection prompt', async () => {
  const g = new Game();
  g.state.difficulty = 'easy';
  await g.setupMatch();

  const attacker = new Card({
    id: 'test-attacker',
    type: 'ally',
    name: 'Test Attacker',
    data: { attack: 3, health: 3, summoningSick: false, enteredTurn: (g.turns.turn || 0) - 1 }
  });
  attacker.owner = g.player;
  g.player.battlefield.add(attacker);

  const enemy = new Card({
    id: 'enemy-blocker',
    type: 'ally',
    name: 'Enemy Blocker',
    data: { attack: 1, health: 2 }
  });
  enemy.owner = g.opponent;
  g.opponent.battlefield.add(enemy);

  const promptSpy = jest.fn(async () => enemy);
  g.promptTarget = promptSpy;

  attacker.data.freezeTurns = 1;
  const blocked = await g.attack(g.player, attacker.id);
  expect(blocked).toBe(false);
  expect(promptSpy).not.toHaveBeenCalled();

  attacker.data.freezeTurns = 0;
  attacker.data.attacksUsed = 0;
  promptSpy.mockClear();

  const resolved = await g.attack(g.player, attacker.id);
  expect(resolved).toBe(true);
  expect(promptSpy).toHaveBeenCalled();
});
