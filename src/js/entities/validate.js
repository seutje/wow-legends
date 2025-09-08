import { invariant } from '../utils/assert.js';

const validTypes = new Set(['hero', 'ally','spell','equipment','quest','consumable']);

export function validateCardShape(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') errs.push('Card must be an object');
  if (!obj.id || typeof obj.id !== 'string') errs.push('Missing id');
  if (!obj.name || typeof obj.name !== 'string') errs.push('Missing name');
  if (!validTypes.has(obj.type)) errs.push('Invalid type');
  if (obj.cost != null && typeof obj.cost !== 'number') errs.push('Invalid cost');
  return errs;
}

export function validateCardDev(obj) {
  const errs = validateCardShape(obj);
  invariant(errs.length === 0, 'Invalid card: ' + errs.join(', '));
}

