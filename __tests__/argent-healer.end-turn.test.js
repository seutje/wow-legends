import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Argent Healer', () => {
  test('heals a random character at end of controller turn', async () => {
    const g = new Game();
    await g.setupMatch();
    g.resources._pool.set(g.player, 10);
    g.rng.pick = arr => arr[0];

    g.player.hero.data.maxHealth = 30;
    g.player.hero.data.health = 20;
    g.opponent.hero.data.maxHealth = 30;
    g.opponent.hero.data.health = 20;

    g.addCardToHand('ally-argent-healer');
    await g.playFromHand(g.player, 'ally-argent-healer');

    expect(g.player.hero.data.health).toBe(20);

    const quest = new Card({ name: 'Quest', type: 'quest', text: '', effects: [] });
    g.player.battlefield.add(quest);

    g.turns.bus.emit('turn:start', { player: g.player });
    expect(g.player.hero.data.health).toBe(20);

    g.turns.bus.emit('turn:start', { player: g.opponent });
    expect(g.player.hero.data.health).toBe(23);
  });
});
