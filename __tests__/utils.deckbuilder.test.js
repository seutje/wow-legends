import { fillDeckRandomly } from '../src/js/utils/deckbuilder.js';
import { RNG } from '../src/js/utils/rng.js';

describe('fillDeckRandomly', () => {
  test('ensures at most one quest in deck', () => {
    const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
    const quest1 = { id: 'q1', name: 'Quest1', type: 'quest', text: '' };
    const quest2 = { id: 'q2', name: 'Quest2', type: 'quest', text: '' };
    const ally = { id: 'a1', name: 'Ally', type: 'ally', text: '', cost: 1, data: { attack: 1, health: 1 } };
    const allCards = [hero, quest1, quest2, ally];
    const state = { hero, cards: [quest1, quest2] };
    fillDeckRandomly(state, allCards, new RNG(1));
    const quests = state.cards.filter(c => c.type === 'quest');
    expect(quests).toHaveLength(1);
    expect(state.cards).toHaveLength(60);
  });
});

