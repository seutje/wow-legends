import Game from '../src/js/game.js';

describe('Freeze duration across turns', () => {
  test('player hero freeze fades after their turn ends', async () => {
    const g = new Game(null);
    await g.setupMatch();
    // Simulate the player hero being frozen (e.g., by Ice Lance on AI turn)
    g.player.hero.data.freezeTurns = 1;

    // Player ends their turn; freeze should tick down now
    await g.endTurn();

    expect(g.player.hero.data.freezeTurns || 0).toBe(0);
  });
});

