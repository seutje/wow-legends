// Lightweight keyword registry and helpers
import { invariant } from '../utils/assert.js';

export const registry = new Map(); // name -> hooks

export function registerKeyword(name, hooks) {
  registry.set(name, hooks);
}

export function getKeyword(name) { return registry.get(name); }

export function clearKeywords() { registry.clear(); }

// Helpers
export function freezeTarget(target, turns = 1) {
  if (!target.data) target.data = {};
  target.data.freezeTurns = Math.max(0, (target.data.freezeTurns || 0) + turns);
}

export function applySilence(target) {
  target.keywords = [];
}

export function enforceTaunt(candidates) {
  const taunts = candidates.filter(c => c?.keywords?.includes?.('Taunt'));
  return taunts.length ? taunts : candidates;
}

export function isTargetable(entity, { allowStealthTargeting = false } = {}) {
  if (!allowStealthTargeting && entity?.keywords?.includes?.('Stealth')) return false;
  return true;
}

export function computeSpellDamage(base, spellDamage = 0) {
  return base + (spellDamage || 0);
}

export function applyLayers(value, modifiers = []) {
  // modifiers: array of {priority, apply: (v)=>v}
  return modifiers
    .slice()
    .sort((a,b) => (a.priority||0)-(b.priority||0))
    .reduce((v, m) => m.apply(v), value);
}

// Default keyword behaviors (minimal stubs where needed)
export function registerDefaults({ resourceSystem } = {}) {
  clearKeywords();

  registerKeyword('Freeze', {
    onDamageDealt({ source, target, amount }) {
      if (source?.keywords?.includes?.('Freeze')) freezeTarget(target, 1);
    }
  });

  registerKeyword('Lifesteal', {
    onDamageDealt({ source, amount }) {
      if (!source?.data) return;
      if (typeof source.data.health === 'number') {
        source.data.health += amount;
      }
    }
  });

  registerKeyword('Silence', { apply: ({ target }) => applySilence(target) });
  registerKeyword('Taunt', {});
  registerKeyword('Stealth', {});

  registerKeyword('Overload', {
    onPlay({ player, amount }) {
      if (resourceSystem && player) resourceSystem.addOverloadNextTurn(player, amount || 1);
    }
  });

  registerKeyword('Combo', { onPlay: ({ comboActive, applyBonus }) => { if (comboActive) applyBonus?.(); } });
  registerKeyword('Summon', { onPlay: ({ summon }) => { summon?.(); } });
  registerKeyword('Burn', {
    onTurnStart({ target }) {
      const dmg = target?.data?.burnDamage || 0;
      if (dmg > 0 && typeof target.data.health === 'number') target.data.health = Math.max(0, target.data.health - dmg);
    }
  });
  registerKeyword('Enrage', {});
  registerKeyword('Armor', {});
  registerKeyword('Choose One', { choose: ({ options, pickIndex = 0 }) => options?.[pickIndex] });
  registerKeyword('Spell Damage', {});
  registerKeyword('Unique', { isAllowed: ({ existingNames, name }) => !existingNames?.includes?.(name) });
}

