import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import Hero from '../src/js/entities/hero.js';

describe('Duplicate allies death removal targets correct instance', () => {
  test('when two allies share id, killing second removes second, not first', async () => {
    const game = new Game(null);
    // Minimal setup without full init
    game.player.hero = new Hero({ name: 'You', data: { health: 30 } });
    game.opponent.hero = new Hero({ name: 'AI', data: { health: 30 } });

    // Two distinct instances with the same card id
    const one = new Card({ id: 'dup-ally', name: 'Soldier', type: 'ally', data: { attack: 1, health: 2 } });
    const two = new Card({ id: 'dup-ally', name: 'Soldier', type: 'ally', data: { attack: 1, health: 1 } });
    game.player.battlefield.cards = [one, two];

    // Reduce second to 0 HP and mark dead
    two.data.health = 0;
    two.data.dead = true;

    await game.cleanupDeaths(game.player, game.opponent);

    // First remains, second is moved off the battlefield
    expect(game.player.battlefield.cards.includes(one)).toBe(true);
    expect(game.player.battlefield.cards.includes(two)).toBe(false);
  });
});

