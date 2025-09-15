import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Infernal on-summon AoE', () => {
  test('Infernal deals 1 to all other characters when summoned', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);
    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];

    // Add a friendly and an enemy minion to verify they take damage
    const friendly = new Card({ name: 'Friendly Test', type: 'ally', data: { attack: 2, health: 3 } });
    const enemy = new Card({ name: 'Enemy Test', type: 'ally', data: { attack: 2, health: 4 } });
    g.player.battlefield.add(friendly);
    g.opponent.battlefield.add(enemy);

    const pHeroStart = g.player.hero.data.health;
    const eHeroStart = g.opponent.hero.data.health;

    g.addCardToHand('spell-summon-infernal');
    await g.playFromHand(g.player, 'spell-summon-infernal');

    const infernal = g.player.battlefield.cards.find(c => c.name === 'Infernal');
    expect(infernal).toBeTruthy();
    expect(infernal.data.health).toBe(6); // should not damage itself

    // All other characters: both heroes and both existing minions should take 1
    expect(g.player.hero.data.health).toBe(pHeroStart - 1);
    expect(g.opponent.hero.data.health).toBe(eHeroStart - 1);
    expect(friendly.data.health).toBe(2);
    expect(enemy.data.health).toBe(3);
  });
});

