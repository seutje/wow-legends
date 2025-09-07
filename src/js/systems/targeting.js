/** Simple targeting helpers. */

export function isTargetLegal(target, criteria = {}) {
  if (!target) return false;
  if (criteria.type && target.type !== criteria.type) return false;
  if (criteria.name && target.name !== criteria.name) return false;
  return true;
}

export function selectTargets(candidates, criteria = {}) {
  return candidates.filter((t) => isTargetLegal(t, criteria));
}

