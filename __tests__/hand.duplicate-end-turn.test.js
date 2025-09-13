import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Hand duplicates on end turn bug', () => {
  test('ending turn with two identical cards draws only one (total 3)', async () => {
    const g = new Game();
    await g.setupMatch();

    // Ensure deterministic: clear hand and deck, then set up specific cards
    g.player.hand.cards = [];
    g.player.library.cards = [];

    // Create two copies of the same card id in hand
    const dataId = 'spell-lightning-bolt';
    const c1 = new Card({ id: dataId, name: 'Lightning Bolt', type: 'spell', cost: 1, effects: [] });
    const c2 = new Card({ id: dataId, name: 'Lightning Bolt', type: 'spell', cost: 1, effects: [] });
    g.player.hand.add(c1);
    g.player.hand.add(c2);

    // Put one known card on top of the library to draw
    const top = new Card({ id: 'spell-whirlwind', name: 'Whirlwind', type: 'spell', cost: 1, effects: [] });
    g.player.library.cards.push(top);

    // End turn (AI turn will be minimal due to empty hand/deck), then our turn starts and we draw 1
    await g.endTurn();

    // Expect: exactly the two duplicates plus the single drawn card
    expect(g.player.hand.cards.length).toBe(3);
  });
});

