import Game from '../src/js/game.js';

describe('Game.reset with explicit opponent deck', () => {
  test('uses provided opponent hero and deck', async () => {
    const game = new Game();
    await game.setupMatch();

    const prebuilt = await game.getPrebuiltDecks();
    expect(Array.isArray(prebuilt)).toBe(true);
    expect(prebuilt.length).toBeGreaterThan(0);
    const playerDeck = prebuilt[0];
    expect(playerDeck?.hero).toBeTruthy();
    expect(playerDeck?.cards?.length).toBe(60);
    const opponentDeck = prebuilt.find((deck) => deck?.hero?.id !== playerDeck.hero.id)
      || prebuilt[0];
    expect(opponentDeck?.hero).toBeTruthy();
    expect(opponentDeck?.cards?.length).toBe(60);

    await game.reset({
      hero: playerDeck.hero,
      cards: playerDeck.cards,
      opponentDeck: {
        hero: opponentDeck.hero,
        cards: opponentDeck.cards,
      },
    });

    expect(game.player.hero?.id).toBe(playerDeck.hero.id);
    expect(game.opponent.hero?.id).toBe(opponentDeck.hero.id);

    const playerLibraryIds = game.player.library.cards.map((card) => card.id);
    const expectedPlayerIds = playerDeck.cards.map((card) => card.id);
    const playerIdSet = new Set(playerLibraryIds);
    const expectedPlayerIdSet = new Set(expectedPlayerIds);
    expect(playerIdSet).toEqual(expectedPlayerIdSet);
    expect(playerLibraryIds.length).toBeGreaterThanOrEqual(expectedPlayerIdSet.size);
    expect(playerLibraryIds.length).toBeLessThanOrEqual(expectedPlayerIds.length);
    expect(playerLibraryIds.every((id) => expectedPlayerIdSet.has(id))).toBe(true);

    const opponentLibraryIds = game.opponent.library.cards.map((card) => card.id);
    const expectedOpponentIds = opponentDeck.cards.map((card) => card.id);
    const opponentIdSet = new Set(opponentLibraryIds);
    const expectedOpponentIdSet = new Set(expectedOpponentIds);
    expect(opponentIdSet).toEqual(expectedOpponentIdSet);
    expect(opponentLibraryIds.length).toBeGreaterThanOrEqual(expectedOpponentIdSet.size);
    expect(opponentLibraryIds.length).toBeLessThanOrEqual(expectedOpponentIds.length);
    expect(opponentLibraryIds.every((id) => expectedOpponentIdSet.has(id))).toBe(true);

    expect(game.state.lastOpponentHeroId).toBe(opponentDeck.hero.id);
  });
});
