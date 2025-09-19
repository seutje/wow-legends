export function getCardInstanceId(card) {
  if (!card) return null;
  const { instanceId, id } = card;
  if (typeof instanceId === 'string' && instanceId.length) return instanceId;
  if (typeof id === 'string' && id.length) return id;
  return null;
}

export function cardsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aId = getCardInstanceId(a);
  const bId = getCardInstanceId(b);
  if (aId && bId && aId === bId) return true;
  if (a?.id && b?.id && a.id === b.id && !aId && !bId) return true;
  return false;
}

export function matchesCardIdentifier(card, identifier) {
  if (!card || identifier == null) return false;
  if (typeof identifier === 'object') {
    return cardsMatch(card, identifier);
  }
  const id = String(identifier);
  const instanceId = getCardInstanceId(card);
  if (instanceId && instanceId === id) return true;
  return card?.id === id;
}

export function cardIdentifier(card) {
  return getCardInstanceId(card);
}

