import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('buffAtEndOfTurn target: randomEnemyAlly', () => {
  test('buffs a random enemy ally at end of controller turn', async () => {
    const g = new Game();
    await g.setupMatch();
    g.resources._pool.set(g.player, 10);
    g.resources._pool.set(g.opponent, 10);
    g.rng.pick = arr => arr[0];

    // Ensure opponent has an ally to be buffed
    const enemyAlly = new Card({ id: 'enemy-minion', name: 'Enemy Minion', type: 'ally', data: { attack: 2, health: 2 }, keywords: [] });
    g.opponent.battlefield.add(enemyAlly);

    // Create a custom ally with buffAtEndOfTurn targeting randomEnemyAlly
    const buffer = new Card({
      id: 'test-buffer',
      name: 'Test Buffer',
      type: 'ally',
      cost: 0,
      data: { attack: 0, health: 1 },
      keywords: [],
      effects: [
        { type: 'buffAtEndOfTurn', target: 'randomEnemyAlly', property: 'attack', amount: 1 }
      ]
    });

    g.player.hand.add(buffer);
    await g.playFromHand(g.player, buffer.id);

    const before = enemyAlly.data.attack;
    // Start of opponent's turn = end of player's turn for this purpose
    g.turns.bus.emit('turn:start', { player: g.opponent });
    expect(enemyAlly.data.attack).toBe(before + 1);
  });
});

