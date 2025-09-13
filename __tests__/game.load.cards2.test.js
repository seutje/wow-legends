import Game from '../src/js/game.js';

describe('Game Card Loading', () => {
  test('loads cards from cards.json and cards-2.json', async () => {
    const g = new Game();
    await g.setupMatch();
    // A known ID from cards.json
    expect(g.allCards.some(c => c.id === 'hero-jaina-proudmoore-archmage')).toBe(true);
    // A known ID from cards-2.json
    expect(g.allCards.some(c => c.id === 'ally-horde-grunt')).toBe(true);
  });
});

