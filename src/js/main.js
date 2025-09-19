import Game from './game.js';
import { renderDeckBuilder } from './ui/deckbuilder.js';
import { renderOptions } from './ui/options.js';
import { setDebugLogging } from './utils/logger.js';
import { fillDeckRandomly } from './utils/deckbuilder.js';
import { renderPlay } from './ui/play.js';
import { loadSettings, rehydrateDeck, saveLastDeck } from './utils/settings.js';
import { deriveDeckFromGame } from './utils/deckstate.js';
import { saveGameState, loadSavedGameState, clearSavedGameState } from './utils/savegame.js';

function qs(sel) { return document.querySelector(sel); }

const root = qs('#root');
const statusEl = qs('#status');
const mainEl = qs('main');

const game = new Game(root);
await game.init();

// Load persisted settings: difficulty and last used deck
try {
  const settings = loadSettings();
  if (settings?.difficulty) {
    game.state.difficulty = settings.difficulty;
    if (settings.difficulty === 'nightmare' || settings.difficulty === 'hybrid') {
      game.preloadNeuralModel?.();
    }
  }
  if (settings?.lastDeck) {
    const deck = rehydrateDeck(settings.lastDeck, game.allCards);
    if (deck) {
      await game.reset(deck);
    }
  }
} catch {}

let loadedFromSave = false;
try {
  loadedFromSave = loadSavedGameState(game);
} catch {}

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

async function startNewGame() {
  const deck = deriveDeckFromGame(game);
  clearSavedGameState();
  const hasDeck = deck?.hero && Array.isArray(deck.cards) && deck.cards.length === 60;
  await game.reset(hasDeck ? deck : null);
  saveGameState(game);
}

const rerender = () => {
  renderPlay(board, game, { onUpdate: rerender, onOpenDeckBuilder: openDeckBuilder, onNewGame: startNewGame });
  saveGameState(game);
};

rerender();

game.setUIRerender(rerender);

// Helpers to smooth AI thinking progress in the browser
const nowMs = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};
const requestFrame = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
  ? window.requestAnimationFrame.bind(window)
  : (cb) => setTimeout(() => cb(nowMs()), 16);
const cancelFrame = (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function')
  ? window.cancelAnimationFrame.bind(window)
  : (id) => clearTimeout(id);

let aiThinkingStartedAt = 0;
let aiProgressFillFrame = 0;
let aiThinkingHoldTimer = null;

const cancelAiProgressFill = () => {
  if (aiProgressFillFrame) {
    cancelFrame(aiProgressFillFrame);
    aiProgressFillFrame = 0;
  }
};

const clearAiThinkingHoldTimer = () => {
  if (aiThinkingHoldTimer) {
    clearTimeout(aiThinkingHoldTimer);
    aiThinkingHoldTimer = null;
  }
};

const animateAiProgressFill = (durationMs, startProgress) => {
  const total = Math.max(0, durationMs);
  const initial = Math.max(0, Math.min(1, startProgress ?? 0));
  if (!game.state) return;
  if (total === 0 || initial >= 1) {
    if (game.state.aiProgress !== 1) {
      game.state.aiProgress = 1;
      rerender();
    }
    return;
  }
  const startTs = nowMs();
  const step = () => {
    aiProgressFillFrame = 0;
    const elapsed = Math.max(0, nowMs() - startTs);
    const t = total > 0 ? Math.min(1, elapsed / total) : 1;
    if (game.state) {
      const current = game.state.aiProgress ?? 0;
      const target = initial + ((1 - initial) * t);
      if (t >= 1 || target - current > 0.001) {
        game.state.aiProgress = target;
        rerender();
      }
    }
    if (t < 1) {
      aiProgressFillFrame = requestFrame(step);
    }
  };
  step();
};

// Reflect AI thinking/progress to UI state and trigger rerenders
game.bus.on('ai:thinking', ({ thinking }) => {
  const now = nowMs();
  if (thinking) {
    aiThinkingStartedAt = now;
    clearAiThinkingHoldTimer();
    cancelAiProgressFill();
    if (game.state) {
      game.state.aiThinking = true;
      game.state.aiProgress = 0;
    }
    rerender();
    return;
  }

  const elapsed = now - aiThinkingStartedAt;
  if (elapsed < 1000) {
    const remaining = Math.max(0, 1000 - elapsed);
    const startProgress = Math.max(0, Math.min(1, game.state?.aiProgress ?? 0));
    if (game.state) game.state.aiThinking = true;
    cancelAiProgressFill();
    animateAiProgressFill(remaining, startProgress);
    clearAiThinkingHoldTimer();
    aiThinkingHoldTimer = setTimeout(() => {
      aiThinkingHoldTimer = null;
      cancelAiProgressFill();
      if (game.state) {
        game.state.aiProgress = 1;
        game.state.aiThinking = false;
      }
      rerender();
    }, remaining);
    return;
  }

  clearAiThinkingHoldTimer();
  cancelAiProgressFill();
  if (game.state) {
    game.state.aiThinking = false;
    game.state.aiProgress = 1;
  }
  rerender();
});

game.bus.on('ai:progress', ({ progress }) => {
  if (!game.state) return;
  const clamped = Math.max(0, Math.min(1, progress ?? 0));
  const current = game.state.aiProgress ?? 0;
  if (clamped >= 1 && current < 1) {
    game.state.aiProgress = 1;
    rerender();
    return;
  }
  if (clamped > current + 0.001) {
    game.state.aiProgress = clamped;
    rerender();
  }
});

if (loadedFromSave && game.state?.aiThinking && game.state?.aiPending?.type === 'mcts') {
  game.resumePendingAITurn().catch(() => {});
}
// Keep UI in sync when quests complete (quest card moves off battlefield)
game.bus.on('quest:completed', () => {
  rerender();
});

function toggleGameVisible(show) {
  board.style.display = show ? 'block' : 'none';
  root.style.display = show ? 'block' : 'none';
  if (mainEl) mainEl.style.gridTemplateColumns = '1fr';
}

// Deck Builder + Options
const sidebar = document.querySelector('#sidebar') || document.createElement('aside');
const deckRoot = document.createElement('div');
deckRoot.style.display = 'none';
const useDeckBtn = document.createElement('button');
useDeckBtn.textContent = 'Use this deck';
useDeckBtn.disabled = true;
const fillRandomBtn = document.createElement('button');
fillRandomBtn.textContent = 'Fill Random';
const clearDeckBtn = document.createElement('button');
clearDeckBtn.textContent = 'Clear Deck';
sidebar.append(useDeckBtn, fillRandomBtn, clearDeckBtn);
sidebar.appendChild(deckRoot);
const optsRoot = document.createElement('div');
sidebar.appendChild(optsRoot);
if (!sidebar.parentElement) root.appendChild(sidebar);
// Hide aside by default; only visible while deck builder is open
sidebar.style.display = 'none';

const deckState = { hero: null, cards: [], selectedPrebuiltDeck: null };
let availablePrebuiltDecks = [];
let prebuiltDecksPromise = null;

function handleSelectPrebuilt(deckName) {
  const normalized = deckName || null;
  if (!normalized) {
    if (deckState.selectedPrebuiltDeck) {
      deckState.selectedPrebuiltDeck = null;
      rerenderDeck();
    }
    return;
  }
  const pool = Array.isArray(availablePrebuiltDecks) ? availablePrebuiltDecks : [];
  const match = pool.find((deck) => deck?.name === normalized) || null;
  if (!match) {
    if (deckState.selectedPrebuiltDeck) {
      deckState.selectedPrebuiltDeck = null;
      rerenderDeck();
    }
    return;
  }
  deckState.hero = match.hero || null;
  deckState.cards = Array.isArray(match.cards) ? match.cards.slice() : [];
  deckState.selectedPrebuiltDeck = match.name || normalized;
  rerenderDeck();
}

async function ensurePrebuiltDecksLoaded() {
  if (Array.isArray(availablePrebuiltDecks) && availablePrebuiltDecks.length > 0) {
    return availablePrebuiltDecks;
  }
  if (prebuiltDecksPromise) return prebuiltDecksPromise;
  if (typeof game.getPrebuiltDecks !== 'function') {
    availablePrebuiltDecks = [];
    return availablePrebuiltDecks;
  }
  prebuiltDecksPromise = (async () => {
    try {
      const decks = await game.getPrebuiltDecks();
      availablePrebuiltDecks = Array.isArray(decks) ? decks : [];
      rerenderDeck();
    } catch {
      availablePrebuiltDecks = [];
    } finally {
      prebuiltDecksPromise = null;
    }
    return availablePrebuiltDecks;
  })();
  return prebuiltDecksPromise;
}

function updateUseDeckBtn() {
  useDeckBtn.disabled = !(deckState.hero && deckState.cards.length === 60);
}
const rerenderDeck = () => {
  renderDeckBuilder(deckRoot, {
    state: deckState,
    allCards: game.allCards,
    onChange: rerenderDeck,
    prebuiltDecks: availablePrebuiltDecks,
    onSelectPrebuilt: handleSelectPrebuilt,
  });
  updateUseDeckBtn();
};
function openDeckBuilder() {
  // Show deck builder in sidebar and hide the game board
  // Load the active deck into the editor state
  try {
    const cur = deriveDeckFromGame(game);
    if (cur.hero) deckState.hero = cur.hero;
    deckState.cards = Array.isArray(cur.cards) ? Array.from(cur.cards) : [];
  } catch {}
  deckState.selectedPrebuiltDeck = null;
  deckRoot.style.display = 'block';
  sidebar.style.display = 'block';
  toggleGameVisible(false);
  rerenderDeck();
  ensurePrebuiltDecksLoaded();
}
fillRandomBtn.addEventListener('click', () => {
  deckState.selectedPrebuiltDeck = null;
  fillDeckRandomly(deckState, game.allCards, game.rng);
  rerenderDeck();
});
clearDeckBtn.addEventListener('click', () => {
  deckState.cards.length = 0;
  deckState.hero = null;
  deckState.selectedPrebuiltDeck = null;
  rerenderDeck();
});
  useDeckBtn.addEventListener('click', async () => {
    if (useDeckBtn.disabled) return;
    deckRoot.style.display = 'none';
    sidebar.style.display = 'none';
    toggleGameVisible(true);
    clearSavedGameState();
    await game.reset({ hero: deckState.hero, cards: deckState.cards });
    // Persist last used deck
    try { saveLastDeck({ hero: deckState.hero, cards: deckState.cards }); } catch {}
    saveGameState(game);
    rerender();
    // No RAF loop; state updates via DOM events
  });
let logsOn = true;
renderOptions(optsRoot, { onReset: async () => { deckState.cards.length = 0; deckState.hero = null; deckState.selectedPrebuiltDeck = null; rerenderDeck(); clearSavedGameState(); await game.reset(); saveGameState(game); rerender(); } });

// Ensure logs mirror saved preference (defaults to false)
setDebugLogging(!!game.state?.debug);
