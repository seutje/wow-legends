import Game from './game.js';
import { renderBoard, wireInteractions } from './ui/board.js';
import Player from './entities/player.js';

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
const player = new Player({ name: 'You' });
// Seed a small library
import('./entities/card.js').then(({ default: Card }) => {
  player.library.add(new Card({ type: 'ally', name: 'Footman' }));
  player.library.add(new Card({ type: 'ally', name: 'Archer' }));
  renderBoard(board, player);
});

wireInteractions(board, player, { onChange: () => renderBoard(board, player) });
