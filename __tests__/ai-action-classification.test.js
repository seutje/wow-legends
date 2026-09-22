import { classifyAction } from '../src/js/systems/ai-action-classification.js';

const hero = (id, health = 30) => ({ id, instanceId: id, type: 'hero', data: { health } });
const state = { player: { hero: hero('own'), battlefield: { cards: [] } },
  opponent: { hero: hero('enemy'), battlefield: { cards: [] } } };
const ally = (id = 'ally') => ({ id, instanceId: id, type: 'ally', name: id, data: { attack: 3, health: 3 } });

describe('tactical action classification', () => {
  test('distinguishes face attacks and minion trades from structured targets', () => {
    expect(classifyAction({ attack: { attacker: ally(), target: state.opponent.hero, targetType: 'hero' } }, state))
      .toMatchObject({ primary: 'attack-face', tags: expect.arrayContaining(['face-pressure']) });
    expect(classifyAction({ attack: { attacker: ally(), target: ally('target'), targetType: 'ally' } }, state))
      .toMatchObject({ primary: 'attack-minion', tags: expect.arrayContaining(['board-control']) });
  });

  test('classifies structured direct damage targets and board clears', () => {
    const face = { card: { type: 'spell', effects: [{ type: 'damage', target: 'enemyHero', amount: 6 }] } };
    const minion = { card: { type: 'spell', effects: [{ type: 'damage', target: 'minion', amount: 6 }] } };
    const clear = { card: { type: 'spell', effects: [{ type: 'damage', target: 'allEnemies', amount: 2 }] } };
    expect(classifyAction(face, state).tags).toEqual(expect.arrayContaining(['direct-damage-face', 'face-pressure']));
    expect(classifyAction(minion, state).tags).toEqual(expect.arrayContaining(['direct-damage-minion', 'board-control']));
    expect(classifyAction(clear, state).tags).toEqual(expect.arrayContaining(['board-clear', 'board-control']));
  });

  test('classifies normal minion play, end turn, and compound actions', () => {
    expect(classifyAction({ card: ally() }, state)).toMatchObject({ primary: 'play-minion', tags: expect.arrayContaining(['development']) });
    expect(classifyAction({ end: true }, state)).toMatchObject({ primary: 'end-turn', tags: ['end-turn'] });
    const compound = classifyAction({ card: ally(), usePower: true }, {
      ...state, player: { ...state.player, hero: { ...state.player.hero, active: [{ type: 'draw', amount: 1 }] } } });
    expect(compound.primary).toBe('play-card-and-hero-power');
    expect(compound.components.map(item => item.primary)).toEqual(['play-minion', 'hero-power']);
    expect(compound.tags).toEqual(expect.arrayContaining(['development', 'hero-power', 'card-advantage']));
  });
});
