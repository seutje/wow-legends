import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Gnomish Tinkerer', () => {
  test('plays a random consumable from the library', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.turn = 10;
    g.resources._pool.set(g.player, 10);

    // Reset zones for deterministic state
    g.player.hand.cards = [];
    g.player.library.cards = [];
    g.player.graveyard.cards = [];
    g.player.battlefield.cards = [];

    g.player.hero.data.maxHealth = 30;
    g.player.hero.data.health = 20;

    g.addCardToHand('ally-gnomish-tinkerer');

    const potionData = g.allCards.find(c => c.id === 'consumable-healing-potion');
    g.player.library.add(new Card(potionData));
    const filler = g.allCards.find(c => c.type === 'spell');
    g.player.library.add(new Card(filler));

    await g.playFromHand(g.player, 'ally-gnomish-tinkerer');

    expect(g.player.hero.data.health).toBe(25);
    expect(g.player.graveyard.cards.some(c => c.id === 'consumable-healing-potion')).toBe(true);
    expect(g.player.library.cards.find(c => c.id === 'consumable-healing-potion')).toBeUndefined();
  });
});

