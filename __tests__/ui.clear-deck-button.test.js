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

test('clear deck button empties deck and disables use', async () => {
  const { hero, allCards } = createCardPool();
  const game = { reset: jest.fn().mockResolvedValue(), allCards };

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
  deckRoot.style.display = 'block';
  const useDeckBtn = document.createElement('button');
  useDeckBtn.disabled = true;
  const fillRandomBtn = document.createElement('button');
  const clearDeckBtn = document.createElement('button');
  sidebar.append(useDeckBtn, fillRandomBtn, clearDeckBtn, deckRoot);
  main.append(root, sidebar);
  document.body.append(main);

  const deckState = { hero: null, cards: [] };
  const toggleGameVisible = (show) => {
    board.style.display = show ? 'block' : 'none';
    root.style.display = show ? 'block' : 'none';
    main.style.gridTemplateColumns = show ? '3fr 1fr' : '1fr';
  };
  function updateUseDeckBtn() {
    useDeckBtn.disabled = !(deckState.hero && deckState.cards.length === 60);
  }
  const rerenderDeck = () => {
    renderDeckBuilder(deckRoot, { state: deckState, allCards: game.allCards, onChange: rerenderDeck });
    updateUseDeckBtn();
  };

  // Wire up buttons like the app
  fillRandomBtn.addEventListener('click', () => {
    fillDeckRandomly(deckState, game.allCards);
    rerenderDeck();
  });
  clearDeckBtn.addEventListener('click', () => {
    deckState.cards.length = 0;
    deckState.hero = null;
    rerenderDeck();
  });
  useDeckBtn.addEventListener('click', async () => {
    if (useDeckBtn.disabled) return;
    deckRoot.style.display = 'none';
    toggleGameVisible(true);
    await game.reset({ hero: deckState.hero, cards: deckState.cards });
  });

  // Fill random first to enable use
  fillRandomBtn.dispatchEvent(new window.Event('click'));
  expect(deckState.hero?.type).toBe('hero');
  expect(deckState.cards.length).toBe(60);
  expect(useDeckBtn.disabled).toBe(false);

  // Clear deck should empty cards AND clear hero, and disable use
  clearDeckBtn.dispatchEvent(new window.Event('click'));
  expect(deckState.hero).toBeNull();
  expect(deckState.cards.length).toBe(0);
  expect(useDeckBtn.disabled).toBe(true);
});
