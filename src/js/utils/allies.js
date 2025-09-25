export function removeOverflowAllies(player, { limit = 5 } = {}) {
  if (!player || !player.battlefield || !Array.isArray(player.battlefield.cards)) {
    return [];
  }

  const allies = player.battlefield.cards.filter((card) => card?.type === 'ally');
  const overflow = allies.length - limit;
  if (overflow <= 0) return [];

  const toRemove = allies.slice(0, overflow);
  const removed = [];

  for (const card of toRemove) {
    let moved = null;
    if (typeof player.battlefield.moveTo === 'function' && player.graveyard) {
      moved = player.battlefield.moveTo(player.graveyard, card);
    }

    if (!moved) {
      const zoneCards = player.battlefield.cards;
      const idx = zoneCards.indexOf(card);
      if (idx !== -1) zoneCards.splice(idx, 1);
      if (player.graveyard) {
        if (typeof player.graveyard.add === 'function') player.graveyard.add(card);
        else if (Array.isArray(player.graveyard.cards)) player.graveyard.cards.push(card);
      }
      moved = card;
    }

    if (moved) removed.push(moved);
  }

  return removed;
}

export default removeOverflowAllies;
