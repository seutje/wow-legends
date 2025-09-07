import Game from './game.js';
import { renderDeckBuilder } from './ui/deckbuilder.js';
import { renderOptions } from './ui/options.js';
import { renderPlay } from './ui/play.js';

function qs(sel) { return document.querySelector(sel); }

const root = qs('#root');
const statusEl = qs('#status');

const game = new Game(root);
game.init();

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
  makeBtn('Start', () => { game.start(); setStatus('Running'); }),
  makeBtn('Reset', () => { game.reset(); setStatus('Reset'); }),
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

// Deck Builder + Options
const sidebar = document.querySelector('#sidebar') || document.createElement('aside');
const deckRoot = document.createElement('div');
const optsRoot = document.createElement('div');
sidebar.appendChild(deckRoot);
sidebar.appendChild(optsRoot);
if (!sidebar.parentElement) root.appendChild(sidebar);

const deck = [];
const rerenderDeck = () => renderDeckBuilder(deckRoot, { deck, onChange: rerenderDeck });
rerenderDeck();
let logsOn = true;
renderOptions(optsRoot, { onReset: () => { deck.length = 0; rerenderDeck(); game.reset(); rerender(); }, onToggleLogs: () => { logsOn = !logsOn; setStatus(logsOn ? 'Logs ON' : 'Logs OFF'); } });
