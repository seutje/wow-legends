import Game from '../src/js/game.js';

describe('autoplay prompt handling', () => {
  test('target prompts resolve automatically while autoplaying', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();

    g.state.aiThinking = true;

    const enemyHero = g.opponent.hero;
    const friendlyHero = g.player.hero;

    const choice = await g.promptTarget([enemyHero, friendlyHero]);

    expect(choice).toBe(enemyHero);
  });

  test('option prompts resolve automatically while autoplaying', async () => {
    const g = new Game();
    await g.setupMatch();
    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();

    g.state.aiThinking = true;
    g.rng.seed(123);

    const selection = await g.promptOption(['One', 'Two', 'Three']);

    expect(selection).toBe(2);
  });
});
