/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderDeckBuilder } from '../src/js/ui/deckbuilder.js';
import { fillDeckRandomly } from '../src/js/utils/deckbuilder.js';

const createCardPool = () => {
  const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
  const allies = Array.from({ length: 20 }, (_, i) => ({
    id: `ally-${i + 1}`,
    name: `Ally ${i + 1}`,
    type: 'ally',
    text: '',
    cost: 1,
    data: { attack: 1, health: 1 },
  }));
  const spells = Array.from({ length: 10 }, (_, i) => ({
    id: `spell-${i + 1}`,
    name: `Spell ${i + 1}`,
    type: 'spell',
    text: '',
  }));
  return { hero, allCards: [hero, ...allies, ...spells] };
};

test('fill random button fills hero and 60 cards and enables use', async () => {
  const { hero, allCards } = createCardPool();
  const game = { reset: jest.fn().mockResolvedValue(), allCards };

  // Build minimal DOM similar to app layout
  const main = document.createElement('main');
  main.style.display = 'grid';
  main.style.gridTemplateColumns = '3fr 1fr';
  const root = document.createElement('div');
  const board = document.createElement('div');
  board.style.display = 'block';
  root.appendChild(board);
  root.style.display = 'block';
  const sidebar = document.createElement('aside');
  const deckRoot = document.createElement('div');
  deckRoot.style.display = 'none';
  const deckBtn = document.createElement('button');
  const useDeckBtn = document.createElement('button');
  useDeckBtn.disabled = true;
  const fillRandomBtn = document.createElement('button');
  sidebar.append(deckBtn, useDeckBtn, fillRandomBtn, deckRoot);
  main.append(root, sidebar);
  document.body.append(main);

  const deckState = { hero: null, cards: [], selectedOpponentHeroId: null };
  const toggleGameVisible = (show) => {
    board.style.display = show ? 'block' : 'none';
    root.style.display = show ? 'block' : 'none';
    main.style.gridTemplateColumns = show ? '3fr 1fr' : '1fr';
  };
  function updateUseDeckBtn() {
    useDeckBtn.disabled = !(deckState.hero && deckState.cards.length === 60);
  }
  let rerenderDeck = () => {};
  const onSelectOpponent = (heroId) => {
    deckState.selectedOpponentHeroId = heroId;
    rerenderDeck();
  };
  rerenderDeck = () => {
    renderDeckBuilder(deckRoot, {
      state: deckState,
      allCards: game.allCards,
      onChange: rerenderDeck,
      onSelectOpponent,
    });
    updateUseDeckBtn();
  };

  deckBtn.addEventListener('click', () => {
    const show = deckRoot.style.display === 'none';
    deckRoot.style.display = show ? 'block' : 'none';
    toggleGameVisible(!show);
    if (show) rerenderDeck();
  });
  fillRandomBtn.addEventListener('click', () => {
    fillDeckRandomly(deckState, game.allCards);
    rerenderDeck();
  });
  useDeckBtn.addEventListener('click', async () => {
    if (useDeckBtn.disabled) return;
    deckRoot.style.display = 'none';
    toggleGameVisible(true);
    const payload = { hero: deckState.hero, cards: deckState.cards };
    if (deckState.selectedOpponentHeroId) payload.opponentHeroId = deckState.selectedOpponentHeroId;
    await game.reset(payload);
  });

  // Open deck builder
  deckBtn.dispatchEvent(new window.Event('click'));
  expect(deckRoot.style.display).toBe('block');
  expect(main.style.gridTemplateColumns).toBe('1fr');

  // Fill random
  fillRandomBtn.dispatchEvent(new window.Event('click'));
  expect(deckState.hero?.type).toBe('hero');
  expect(deckState.cards.length).toBe(60);
  expect(useDeckBtn.disabled).toBe(false);

  // Use deck
  useDeckBtn.dispatchEvent(new window.Event('click'));
  await Promise.resolve();
  expect(deckRoot.style.display).toBe('none');
  expect(main.style.gridTemplateColumns).toBe('3fr 1fr');
  expect(game.reset).toHaveBeenCalledWith({ hero: deckState.hero, cards: deckState.cards });
});

