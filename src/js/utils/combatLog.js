const SECRET_FALLBACK = 'Secret';

function formatSecretName(card, token) {
  if (card?.name) return card.name;
  const type = token?.type || token?.effect?.type;
  if (!type) return SECRET_FALLBACK;
  const normalized = String(type)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!normalized) return SECRET_FALLBACK;
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function logSecretTriggered(game, owner, { card = null, token = null } = {}) {
  if (!game || !owner) return;
  const secretName = formatSecretName(card, token);
  if (Array.isArray(owner.log)) owner.log.push(`Secret triggered: ${secretName}`);
  const opponent = owner === game.player ? game.opponent : game.player;
  if (opponent && Array.isArray(opponent.log)) {
    opponent.log.push(`Enemy secret triggered: ${secretName}`);
  }
}

export default logSecretTriggered;
