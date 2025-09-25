const SECRET_FALLBACK = 'Secret';

export function appendLogEntry(owner, message, { turn = null } = {}) {
  if (!owner || !Array.isArray(owner.log)) return;
  if (message == null) return;
  const resolvedTurn = Number.isFinite(turn)
    ? Math.max(1, Math.trunc(turn))
    : (Number.isFinite(owner?.logTurn) ? Math.max(1, Math.trunc(owner.logTurn)) : null);
  const text = typeof message === 'string' ? message : String(message);
  const entry = resolvedTurn != null ? `${resolvedTurn}: ${text}` : text;
  owner.log.push(entry);
}

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
  appendLogEntry(owner, `Secret triggered: ${secretName}`, { turn: game?.turns?.turn });
  const opponent = owner === game.player ? game.opponent : game.player;
  if (opponent && Array.isArray(opponent.log)) {
    appendLogEntry(opponent, `Enemy secret triggered: ${secretName}`, { turn: game?.turns?.turn });
  }
}

export default logSecretTriggered;
