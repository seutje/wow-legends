import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Warsong Raider', () => {
  test('gains attack when surviving damage', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.addCardToHand('ally-warsong-raider');
    await g.playFromHand(g.player, 'ally-warsong-raider');
    const raider = g.player.battlefield.cards.find(c => c.name === 'Warsong Raider');
    expect(raider.data.attack).toBe(3);

    await g.effects.dealDamage({ target: 'allCharacters', amount: 1 }, { game: g, player: g.player, card: null });
    expect(raider.data.health).toBe(2);
    expect(raider.data.attack).toBe(5);

    await g.effects.dealDamage({ target: 'allCharacters', amount: 1 }, { game: g, player: g.player, card: null });
    expect(raider.data.health).toBe(1);
    expect(raider.data.attack).toBe(7);
  });

  test('combat damage also grants attack when surviving', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.addCardToHand('ally-warsong-raider');
    await g.playFromHand(g.player, 'ally-warsong-raider');
    const raider = g.player.battlefield.cards.find(c => c.name === 'Warsong Raider');
    const enemy = new Card({ name: 'Grunt', type: 'ally', data: { attack: 1, health: 2 } });
    g.opponent.battlefield.cards = [enemy];
    await g.attack(g.opponent, enemy.id, raider.id);
    expect(raider.data.health).toBe(2);
    expect(raider.data.attack).toBe(5);
  });
});
