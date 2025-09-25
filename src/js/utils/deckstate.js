// Build a deck definition from the current game state
// Returns { hero, cards } where both elements come from `game.allCards`
export function deriveDeckFromGame(game) {
  if (!game?.allCards || !game?.player) return { hero: null, cards: [] };
  const all = game.allCards;
  const hero = all.find(c => c.id === game.player?.hero?.id && c.type === 'hero') || null;
  const zones = [
    game.player?.library?.cards || [],
    game.player?.hand?.cards || [],
    game.player?.battlefield?.cards || [],
    game.player?.graveyard?.cards || [],
    game.player?.removed?.cards || [],
  ];
  const cards = [];
  for (const zone of zones) {
    for (const inst of zone) {
      if (!inst || inst.type === 'hero') continue;
      if (inst.summonedBy) continue; // ignore tokens created during play
      const data = all.find(c => c.id === inst.id && c.type !== 'hero');
      if (data) cards.push(data);
    }
  }
  const deck = { hero, cards };
  const opponentHeroId = game?.state?.lastOpponentHeroId;
  if (opponentHeroId) deck.opponentHeroId = opponentHeroId;
  return deck;
}

export default deriveDeckFromGame;
