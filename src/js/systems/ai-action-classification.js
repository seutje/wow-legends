import { matchesCardIdentifier } from '../utils/card.js';

const unique = values => [...new Set(values.filter(Boolean))];
const component = (primary, tags = []) => ({ primary, tags: unique(tags) });
const effectsOf = source => Array.isArray(source?.effects) ? source.effects : Array.isArray(source?.active) ? source.active : [];

function classifyEffects(source, state, immediateEffects = null) {
  const effects = effectsOf(source); const tags = []; const classes = [];
  const damage = effects.filter(effect => ['damage', 'damageArmor', 'destroy'].includes(effect?.type));
  const aoe = damage.some(effect => ['allEnemies', 'allCharacters', 'allOtherCharacters', 'enemyBoard'].includes(effect.target));
  const explicitHero = damage.some(effect => ['enemyHero', 'opponentHero', 'hero'].includes(effect.target));
  const explicitMinion = damage.some(effect => ['minion', 'enemyMinion'].includes(effect.target));
  if (aoe) { classes.push('board-clear'); tags.push('board-control', 'tempo'); }
  else if (damage.length) {
    if (explicitHero || immediateEffects?.opponentHeroDamageImmediate > 0) {
      classes.push('direct-damage-face'); tags.push('face-pressure', 'tempo');
    } else if (explicitMinion || (immediateEffects?.enemyMinionsRemoved || 0) > 0
      || (immediateEffects?.enemyBoardAttackDelta || 0) > 0) {
      classes.push('direct-damage-minion', 'single-target-removal'); tags.push('board-control', 'tempo');
    } else tags.push('tempo');
  }
  if (effects.some(effect => ['buff', 'damageBonus', 'grantKeyword', 'friendlyAuraBuff', 'buffBeast', 'buffTribe'].includes(effect?.type))) classes.push('buff');
  if (effects.some(effect => ['heal', 'restore'].includes(effect?.type))) { classes.push('heal'); tags.push('defensive'); }
  if (effects.some(effect => effect?.type === 'draw')) { classes.push('draw'); tags.push('card-advantage'); }
  if (effects.some(effect => effect?.type === 'summon')) { classes.push('summon'); tags.push('development'); }
  if (classes.includes('buff')) tags.push('development');
  return { classes: unique(classes), tags: unique(tags) };
}

function classifyCard(card, state, immediateEffects) {
  const type = card?.type === 'ally' ? 'play-minion' : card?.type === 'spell' || card?.type === 'consumable'
    ? 'play-spell' : card?.type === 'equipment' ? 'play-weapon' : 'play-other';
  const baseTags = type === 'play-minion' || type === 'play-weapon' ? ['development'] : [];
  const effects = classifyEffects(card, state, immediateEffects);
  return component(type, [...baseTags, ...effects.classes, ...effects.tags]);
}

export function classifyAction(action, state, { immediateEffects = null } = {}) {
  if (!action) return { primary: 'other', tags: [] };
  if (action.end) return { primary: 'end-turn', tags: ['end-turn'], strategic: 'end-turn' };
  if (action.attack) {
    const targetHero = action.attack.targetType === 'hero'
      || matchesCardIdentifier(action.attack.target, state?.opponent?.hero);
    return { primary: targetHero ? 'attack-face' : 'attack-minion',
      tags: ['attack', targetHero ? 'face-pressure' : 'board-control'],
      strategic: targetHero ? 'face-pressure' : 'board-control' };
  }
  const components = [];
  if (action.card) components.push(classifyCard(action.card, state, immediateEffects));
  if (action.usePower) {
    const powerEffects = classifyEffects(state?.player?.hero, state, immediateEffects);
    components.push(component('hero-power', ['hero-power', ...powerEffects.classes, ...powerEffects.tags]));
  }
  if (!components.length) return { primary: 'other', tags: [] };
  const tags = unique(components.flatMap(item => [item.primary, ...item.tags]));
  const strategic = tags.includes('face-pressure') ? 'face-pressure' : tags.includes('board-control') ? 'board-control'
    : tags.includes('development') ? 'development' : tags.includes('card-advantage') ? 'card-advantage'
      : tags.includes('defensive') ? 'defensive' : tags.includes('end-turn') ? 'end-turn' : 'other';
  if (components.length > 1) return { primary: 'play-card-and-hero-power', components, tags, strategic };
  return { ...components[0], strategic };
}

export function primaryStrategicCategory(classification) {
  return classification?.strategic || (classification?.tags?.includes('face-pressure') ? 'face-pressure'
    : classification?.tags?.includes('board-control') ? 'board-control'
      : classification?.tags?.includes('development') ? 'development' : 'other');
}
