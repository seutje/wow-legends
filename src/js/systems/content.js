import { validateCardShape } from '../entities/validate.js';

export function validateCardData(card) {
  const errs = validateCardShape(card);
  if (errs.length) throw new Error('Invalid card: ' + errs.join(', '));
  return true;
}

export function loadFromModule(mod) {
  const cards = (mod && (mod.default || mod.cards)) || [];
  if (!Array.isArray(cards)) throw new Error('Module must export array as default or `cards`');
  for (const c of cards) validateCardData(c);
  return cards;
}

