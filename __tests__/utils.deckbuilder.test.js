import { fillDeckRandomly } from '../src/js/utils/deckbuilder.js';
import { RNG } from '../src/js/utils/rng.js';

const buildAllCards = () => {
  const hero = { id: 'hero-1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
  const quests = Array.from({ length: 2 }, (_, i) => ({
    id: `quest-${i + 1}`,
    name: `Quest ${i + 1}`,
    type: 'quest',
    text: '',
  }));
  const allies = Array.from({ length: 20 }, (_, i) => ({
    id: `ally-${i + 1}`,
    name: `Ally ${i + 1}`,
    type: 'ally',
    text: '',
    cost: 1,
    data: { attack: 1, health: 1 },
  }));
  const equipments = Array.from({ length: 2 }, (_, i) => ({
    id: `equipment-${i + 1}`,
    name: `Equipment ${i + 1}`,
    type: 'equipment',
    text: '',
  }));
  const spells = Array.from({ length: 10 }, (_, i) => ({
    id: `spell-${i + 1}`,
    name: `Spell ${i + 1}`,
    type: 'spell',
    text: '',
  }));

  return {
    hero,
    quests,
    allies,
    equipments,
    spells,
    allCards: [hero, ...quests, ...allies, ...equipments, ...spells],
  };
};

describe('fillDeckRandomly', () => {
  test('enforces deck building constraints', () => {
    const { hero, quests, allies, equipments, spells, allCards } = buildAllCards();
    const state = {
      hero,
      cards: [
        ...quests,
        ...Array(4).fill(allies[0]),
        equipments[0],
        equipments[1],
        equipments[1],
        equipments[1],
        spells[0],
        spells[1],
      ],
    };

    fillDeckRandomly(state, allCards, new RNG(1));

    expect(state.hero).toBe(hero);
    expect(state.cards).toHaveLength(60);
    expect(state.cards.every(card => card.type !== 'quest')).toBe(true);

    const counts = state.cards.reduce((acc, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});
    Object.values(counts).forEach(count => {
      expect(count).toBeLessThanOrEqual(3);
    });

    const equipmentCards = state.cards.filter(card => card.type === 'equipment');
    const equipmentIds = new Set(equipmentCards.map(card => card.id));
    expect(equipmentIds.size).toBeLessThanOrEqual(1);
    if (equipmentCards.length > 0) {
      expect(equipmentCards.length).toBeLessThanOrEqual(3);
    }

    const allyCount = state.cards.filter(card => card.type === 'ally').length;
    expect(allyCount).toBeGreaterThanOrEqual(30);
  });

  test('assigns hero when missing and fills to 60 cards', () => {
    const { allCards } = buildAllCards();
    const state = { hero: null, cards: [] };

    fillDeckRandomly(state, allCards, new RNG(2));

    expect(state.hero?.type).toBe('hero');
    expect(state.cards).toHaveLength(60);
    const allyCount = state.cards.filter(card => card.type === 'ally').length;
    expect(allyCount).toBeGreaterThanOrEqual(30);
  });
});

