import Game from '../src/js/game.js';

describe('promptTarget preferred side ordering', () => {
  test('prioritizes friendly characters when requested', async () => {
    const g = new Game();
    await g.setupMatch();

    const friendlyHero = g.player.hero;
    const enemyHero = g.opponent.hero;

    const choice = await g.promptTarget([enemyHero, friendlyHero], {
      preferredSide: 'friendly',
      actingPlayer: g.player,
    });

    expect(choice === friendlyHero).toBe(true);
  });

  test('autoplay prefers friendly targets when requested', async () => {
    const g = new Game();
    await g.setupMatch();

    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();
    g.state.aiThinking = true;

    const friendlyHero = g.player.hero;
    const enemyHero = g.opponent.hero;

    const choice = await g.promptTarget([enemyHero, friendlyHero], {
      preferredSide: 'friendly',
      actingPlayer: g.player,
    });

    expect(choice === friendlyHero).toBe(true);
  });
});
