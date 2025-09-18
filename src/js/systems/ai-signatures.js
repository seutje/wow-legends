export function cardSignature(card) {
  if (!card) return 'no-card';
  if (card.id) return `id:${card.id}`;
  const data = card.data || {};
  const attack = data.attack ?? card.attack ?? '';
  const health = data.health ?? card.health ?? '';
  const armor = data.armor ?? card.armor ?? '';
  const durability = data.durability ?? card.durability ?? '';
  const keywords = Array.isArray(card.keywords) ? [...card.keywords].sort().join('.') : '';
  const parts = [
    `name:${card.name || ''}`,
    `type:${card.type || ''}`,
    `cost:${card.cost ?? ''}`,
    `atk:${attack}`,
    `hp:${health}`,
  ];
  if (armor !== '') parts.push(`armor:${armor}`);
  if (durability !== '') parts.push(`dur:${durability}`);
  if (keywords) parts.push(`kw:${keywords}`);
  return parts.join('|');
}

export function actionSignature(action) {
  if (!action) return 'noop';
  const cardPart = action.card ? cardSignature(action.card) : 'no-card';
  const usePower = action.usePower ? 'power:1' : 'power:0';
  const end = action.end ? 'end:1' : 'end:0';
  return `${cardPart}|${usePower}|${end}`;
}

export default actionSignature;
