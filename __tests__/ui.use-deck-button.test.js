/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderDeckBuilder } from '../src/js/ui/deckbuilder.js';

function setup() {
  const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
  const ally = { id: 'a1', name: 'Ally', type: 'ally', text: '', cost: 1, data: { attack: 1, health: 1 } };
  const allCards = [hero, ally];
  const game = {
    reset: jest.fn().mockResolvedValue(),
    setupMatch: jest.fn().mockResolvedValue(),
    start: jest.fn(),
    allCards
  };
  const main = document.createElement('main');
  main.style.display = 'grid';
  main.style.gridTemplateColumns = '3fr 1fr';
  const root = document.createElement('div');
  const board = document.createElement('div');
  board.style.display = 'block';
  root.appendChild(board);
  root.style.display = 'block';
  const sidebar = document.createElement('aside');
  const controls = document.createElement('div');
  controls.style.display = 'block';
  const deckRoot = document.createElement('div');
  deckRoot.style.display = 'none';
  const deckBtn = document.createElement('button');
  const useDeckBtn = document.createElement('button');
  useDeckBtn.disabled = true;
  sidebar.append(deckBtn, useDeckBtn, deckRoot);
  main.append(root, sidebar);
  document.body.append(main);
  const deckState = { hero: null, cards: [] };
  const toggleGameVisible = show => {
    board.style.display = show ? 'block' : 'none';
    controls.style.display = show ? 'block' : 'none';
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
  deckBtn.addEventListener('click', () => {
    const show = deckRoot.style.display === 'none';
    deckRoot.style.display = show ? 'block' : 'none';
    toggleGameVisible(!show);
    if (show) rerenderDeck();
  });
  const useDeckHandler = async () => {
    if (useDeckBtn.disabled) return;
    deckRoot.style.display = 'none';
    toggleGameVisible(true);
    await game.reset();
    await game.setupMatch({ hero: deckState.hero, cards: deckState.cards });
    game.start();
  };
  useDeckBtn.addEventListener('click', useDeckHandler);
  return { game, board, controls, deckRoot, deckBtn, useDeckBtn, deckState, useDeckHandler, main, root };
}

test('use deck button enables after building deck and starts game', async () => {
  const { game, board, deckRoot, deckBtn, useDeckBtn, useDeckHandler, main, root } = setup();
  deckBtn.dispatchEvent(new window.Event('click'));
  expect(board.style.display).toBe('none');
  expect(root.style.display).toBe('none');
  expect(main.style.gridTemplateColumns).toBe('1fr');
  const tips = deckRoot.querySelectorAll('.card-tooltip');
  tips[0].dispatchEvent(new window.Event('click'));
  for (let i = 0; i < 60; i++) {
    tips[1].dispatchEvent(new window.Event('click'));
  }
  expect(useDeckBtn.disabled).toBe(false);
  await useDeckHandler();
  expect(deckRoot.style.display).toBe('none');
  expect(board.style.display).toBe('block');
  expect(root.style.display).toBe('block');
  expect(main.style.gridTemplateColumns).toBe('3fr 1fr');
  expect(game.reset).toHaveBeenCalled();
  expect(game.setupMatch).toHaveBeenCalled();
  expect(game.start).toHaveBeenCalled();
});
