/** Simple targeting helpers. */

import { enforceTaunt, isTargetable } from './keywords.js';

export function isTargetLegal(target, criteria = {}) {
  if (!target) return false;
  if (target.type === 'quest') return false;
  if (criteria.type && target.type !== criteria.type) return false;
  if (criteria.name && target.name !== criteria.name) return false;
  return true;
}

export function selectTargets(candidates, criteria = {}, options = {}) {
  const legal = candidates
    .filter((t) => isTargetLegal(t, criteria))
    .filter((t) => isTargetable(t, options));
  return enforceTaunt(legal);
}

