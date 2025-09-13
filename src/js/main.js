import Game from './game.js';
import { renderDeckBuilder } from './ui/deckbuilder.js';
import { renderOptions } from './ui/options.js';
import { fillDeckRandomly } from './utils/deckbuilder.js';
import { renderPlay } from './ui/play.js';

function qs(sel) { return document.querySelector(sel); }

const root = qs('#root');
const statusEl = qs('#status');
const mainEl = qs('main');

const game = new Game(root);
await game.init();

// Expose for quick dev console hooks
window.game = game;

// Removed manual Start/Reset/Dispose controls; gameplay reacts via DOM events

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

setStatus('Initialized');

// Render a minimal board for demo
const board = document.createElement('div');
root.appendChild(board);
const rerender = () => renderPlay(board, game, { onUpdate: rerender });
rerender();

game.setUIRerender(rerender);

function toggleGameVisible(show) {
  board.style.display = show ? 'block' : 'none';
  root.style.display = show ? 'block' : 'none';
  if (mainEl) mainEl.style.gridTemplateColumns = show ? '3fr 1fr' : '1fr';
}

// Deck Builder + Options
const sidebar = document.querySelector('#sidebar') || document.createElement('aside');
const deckRoot = document.createElement('div');
deckRoot.style.display = 'none';
const deckBtn = document.createElement('button');
deckBtn.textContent = 'Deck Builder';
const useDeckBtn = document.createElement('button');
useDeckBtn.textContent = 'Use this deck';
useDeckBtn.disabled = true;
const fillRandomBtn = document.createElement('button');
fillRandomBtn.textContent = 'Fill Random';
sidebar.append(deckBtn, useDeckBtn, fillRandomBtn);
sidebar.appendChild(deckRoot);
const optsRoot = document.createElement('div');
sidebar.appendChild(optsRoot);
if (!sidebar.parentElement) root.appendChild(sidebar);

const deckState = { hero: null, cards: [] };
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
fillRandomBtn.addEventListener('click', () => {
  fillDeckRandomly(deckState, game.allCards, game.rng);
  rerenderDeck();
});
  useDeckBtn.addEventListener('click', async () => {
    if (useDeckBtn.disabled) return;
    deckRoot.style.display = 'none';
    toggleGameVisible(true);
    await game.reset({ hero: deckState.hero, cards: deckState.cards });
    rerender();
    // No RAF loop; state updates via DOM events
  });
let logsOn = true;
renderOptions(optsRoot, { onReset: async () => { deckState.cards.length = 0; deckState.hero = null; rerenderDeck(); await game.reset(); rerender(); }, onToggleLogs: () => { logsOn = !logsOn; setStatus(logsOn ? 'Logs ON' : 'Logs OFF'); } });
