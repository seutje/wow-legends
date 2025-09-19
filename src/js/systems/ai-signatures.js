import { getCardInstanceId } from '../utils/card.js';

export function cardSignature(card) {
  if (!card) return 'no-card';
  const instanceId = getCardInstanceId(card);
  const templateId = typeof card.id === 'string' ? card.id : null;
  if (instanceId) {
    if (templateId && templateId !== instanceId) return `id:${instanceId}:${templateId}`;
    return `id:${instanceId}`;
  }
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
  let attackPart = 'attack:none';
  if (action.attack) {
    const describe = (ref, explicit) => {
      const instance = explicit || getCardInstanceId(ref) || null;
      const template = (ref && typeof ref.id === 'string') ? ref.id : null;
      if (instance && template && instance !== template) return `${instance}:${template}`;
      return instance || template || 'unknown';
    };
    const attackerLabel = describe(action.attack.attacker, action.attack.attackerId);
    const targetLabel = (() => {
      if (action.attack.targetId == null && !action.attack.target) return 'face';
      return describe(action.attack.target, action.attack.targetId);
    })();
    attackPart = `attack:${attackerLabel}->${targetLabel}`;
  }
  const usePower = action.usePower ? 'power:1' : 'power:0';
  const end = action.end ? 'end:1' : 'end:0';
  const targets = (typeof action.__mctsTargetSignature === 'string' && action.__mctsTargetSignature.length)
    ? `targets:${action.__mctsTargetSignature}`
    : 'targets:none';
  return `${cardPart}|${attackPart}|${usePower}|${end}|${targets}`;
}

export default actionSignature;
