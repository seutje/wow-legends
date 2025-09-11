import Game from './game.js';
import { renderDeckBuilder } from './ui/deckbuilder.js';
import { renderOptions } from './ui/options.js';
import { renderPlay } from './ui/play.js';

function qs(sel) { return document.querySelector(sel); }

const root = qs('#root');
const statusEl = qs('#status');

const game = new Game(root);
await game.init();

// Expose for quick dev console hooks
window.game = game;

// Basic UI controls
function makeBtn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  b.style.marginRight = '8px';
  return b;
}

const controls = document.createElement('div');
controls.append(
  makeBtn('Start', async () => { await game.setupMatch(deckState.hero && deckState.cards.length === 60 ? { hero: deckState.hero, cards: deckState.cards } : undefined); game.start(); setStatus('Running'); }),
  makeBtn('Reset', async () => { await game.reset(); setStatus('Reset'); }),
  makeBtn('Dispose', () => { game.dispose(); setStatus('Disposed'); }),
);

qs('header')?.appendChild(controls);

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

// Deck Builder + Options
const sidebar = document.querySelector('#sidebar') || document.createElement('aside');
const deckRoot = document.createElement('div');
deckRoot.style.display = 'none';
const deckBtn = document.createElement('button');
deckBtn.textContent = 'Deck Builder';
sidebar.appendChild(deckBtn);
sidebar.appendChild(deckRoot);
const optsRoot = document.createElement('div');
sidebar.appendChild(optsRoot);
if (!sidebar.parentElement) root.appendChild(sidebar);

const deckState = { hero: null, cards: [] };
const rerenderDeck = () => renderDeckBuilder(deckRoot, { state: deckState, allCards: game.allCards, onChange: rerenderDeck });
deckBtn.addEventListener('click', () => {
  const show = deckRoot.style.display === 'none';
  deckRoot.style.display = show ? 'block' : 'none';
  if (show) rerenderDeck();
});
let logsOn = true;
renderOptions(optsRoot, { onReset: async () => { deckState.cards.length = 0; deckState.hero = null; rerenderDeck(); await game.reset(); rerender(); }, onToggleLogs: () => { logsOn = !logsOn; setStatus(logsOn ? 'Logs ON' : 'Logs OFF'); } });
