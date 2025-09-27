import Game from './game.js';
import { renderDeckBuilder } from './ui/deckbuilder.js';
import { cardTooltip } from './ui/cardTooltip.js';
import { renderOptions } from './ui/options.js';
import { setDebugLogging } from './utils/logger.js';
import { fillDeckRandomly } from './utils/deckbuilder.js';
import { renderPlay } from './ui/play.js';
import { loadSettings, rehydrateDeck, saveLastDeck } from './utils/settings.js';
import { deriveDeckFromGame } from './utils/deckstate.js';
import { saveGameState, loadSavedGameState, clearSavedGameState, hasSavedGameState } from './utils/savegame.js';

function qs(sel) { return document.querySelector(sel); }

function startLoadingOverlay(message = 'Loading game data…') {
  if (typeof document === 'undefined') return null;
  const parent = document.body || document.documentElement;
  if (!parent) return null;
  const overlay = document.createElement('div');
  overlay.className = 'ai-overlay';
  overlay.dataset.loading = '1';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const msgEl = document.createElement('p');
  msgEl.className = 'msg';
  msgEl.textContent = message;
  const progressEl = document.createElement('div');
  progressEl.className = 'progress';
  progressEl.dataset.complete = '0';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let progressPos = 0.12;
  progressEl.style.setProperty('--progress-pos', progressPos.toFixed(4));
  panel.append(msgEl, progressEl);
  overlay.append(panel);
  parent.appendChild(overlay);

  let done = false;
  let frameId = 0;
  const min = 0.08;
  const max = 0.92;
  let direction = 1;
  const hasRAF = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
  const hasCancelRAF = typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function';
  const schedule = (cb) => {
    if (hasRAF) return window.requestAnimationFrame(cb);
    return setTimeout(cb, 80);
  };
  const cancel = (id) => {
    if (hasRAF && hasCancelRAF) {
      window.cancelAnimationFrame(id);
    } else {
      clearTimeout(id);
    }
  };
  const step = () => {
    frameId = 0;
    if (done) return;
    progressPos += direction * 0.012;
    if (progressPos >= max || progressPos <= min) {
      direction *= -1;
      progressPos = clamp(progressPos, min, max);
    }
    progressEl.style.setProperty('--progress-pos', progressPos.toFixed(4));
    frameId = schedule(step);
  };
  frameId = schedule(step);

  return {
    finish(success = true) {
      if (done) return;
      done = true;
      if (frameId) {
        cancel(frameId);
        frameId = 0;
      }
      if (success) {
        progressEl.dataset.complete = '1';
        progressEl.style.setProperty('--progress-pos', '1');
        setTimeout(() => overlay.remove(), 180);
      } else {
        overlay.remove();
      }
    },
  };
}

const root = qs('#root');
const statusEl = qs('#status');
const mainEl = qs('main');

const game = new Game(root);
const loadingOverlay = startLoadingOverlay('Loading game data…');
let initSucceeded = false;
let deckBuilderOpen = false;
try {
  setStatus('Loading game data…');
  await game.init();
  initSucceeded = true;
} finally {
  loadingOverlay?.finish(initSucceeded);
}

// Load persisted settings: difficulty and last used deck
try {
  const settings = loadSettings();
  if (settings?.difficulty) {
    game.state.difficulty = settings.difficulty;
    if (settings.difficulty === 'nightmare' || settings.difficulty === 'insane') {
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

const heroCards = Array.isArray(game.allCards)
  ? game.allCards.filter((card) => card?.type === 'hero')
  : [];
const sortedHeroes = heroCards.slice().sort((a, b) => {
  const aLabel = a?.name ? String(a.name) : String(a?.id ?? '');
  const bLabel = b?.name ? String(b.name) : String(b?.id ?? '');
  return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base', numeric: true });
});

let availablePrebuiltDecks = [];
let prebuiltDecksPromise = null;

let savedGameAvailable = hasSavedGameState();
autoSaveEnabled = !savedGameAvailable;

const resumeAiIfNeeded = () => {
  if (game.state?.aiThinking && game.state?.aiPending?.type === 'mcts') {
    game.resumePendingAITurn().catch(() => {});
  }
};

let startScreenActive = false;
let startScreenEls = null;

function getStartScreenEls() {
  if (startScreenEls || typeof document === 'undefined') return startScreenEls;
  const parent = document.body || document.documentElement;
  if (!parent) return null;
  const overlay = document.createElement('div');
  overlay.className = 'start-screen';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'start-screen__panel';
  overlay.appendChild(panel);
  parent.appendChild(overlay);
  startScreenEls = { overlay, panel };
  return startScreenEls;
}

function showStartOverlay() {
  const els = getStartScreenEls();
  if (!els) return null;
  startScreenActive = true;
  autoSaveEnabled = false;
  toggleGameVisible(false);
  els.overlay.hidden = false;
  return els;
}

function hideStartScreen() {
  if (!startScreenActive) return;
  const els = getStartScreenEls();
  if (!els) return;
  startScreenActive = false;
  els.overlay.hidden = true;
  els.panel.innerHTML = '';
  toggleGameVisible(true);
}

function buildDeckForHero(hero) {
  if (!hero) return null;
  const heroId = hero.id;
  const prebuilt = Array.isArray(availablePrebuiltDecks)
    ? availablePrebuiltDecks.find((deck) => deck?.hero?.id === heroId)
    : null;
  if (prebuilt) {
    return {
      hero: prebuilt.hero,
      cards: Array.isArray(prebuilt.cards) ? prebuilt.cards.slice() : [],
    };
  }
  const state = { hero, cards: [] };
  fillDeckRandomly(state, game.allCards, game.rng);
  return {
    hero: state.hero,
    cards: Array.isArray(state.cards) ? state.cards.slice() : [],
  };
}

function renderStartHome(message = null) {
  const els = showStartOverlay();
  if (!els) {
    if (savedGameAvailable) {
      try {
        const ok = loadSavedGameState(game);
        if (ok) {
          autoSaveEnabled = true;
          rerender();
          resumeAiIfNeeded();
        }
      } catch {}
    }
    return;
  }
  const { panel } = els;
  panel.innerHTML = '';
  const title = document.createElement('h2');
  title.className = 'start-screen__title';
  title.textContent = 'Start Game';
  panel.appendChild(title);
  if (message) {
    const msg = document.createElement('p');
    msg.className = 'start-screen__message';
    msg.textContent = message;
    panel.appendChild(msg);
  }
  const buttons = document.createElement('div');
  buttons.className = 'start-screen__buttons';
  if (savedGameAvailable) {
    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'start-screen__button';
    continueBtn.textContent = 'Continue';
    continueBtn.addEventListener('click', handleContinue);
    buttons.appendChild(continueBtn);
  }
  const newGameBtn = document.createElement('button');
  newGameBtn.type = 'button';
  newGameBtn.className = 'start-screen__button start-screen__button--primary';
  newGameBtn.textContent = 'New Game';
  newGameBtn.addEventListener('click', renderHeroSelection);
  buttons.appendChild(newGameBtn);
  panel.appendChild(buttons);
}

function createHeroOption(hero, onSelect) {
  const option = cardTooltip(hero);
  option.classList.add('start-screen__hero-card');
  option.tabIndex = 0;
  option.setAttribute('role', 'button');
  const label = hero?.name ? String(hero.name) : String(hero?.id ?? 'Hero');
  option.setAttribute('aria-label', `Select ${label}`);
  const activate = () => onSelect(hero);
  option.addEventListener('click', activate);
  option.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      activate();
    }
  });
  return option;
}

function renderHeroSelection() {
  const els = showStartOverlay();
  if (!els) return;
  const { panel } = els;
  panel.innerHTML = '';
  const title = document.createElement('h2');
  title.className = 'start-screen__title';
  title.textContent = 'Choose your hero';
  panel.appendChild(title);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'start-screen__back';
  back.textContent = 'Back';
  back.addEventListener('click', () => renderStartHome());
  panel.appendChild(back);
  if (!sortedHeroes.length) {
    const msg = document.createElement('p');
    msg.className = 'start-screen__message';
    msg.textContent = 'No heroes are available.';
    panel.appendChild(msg);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'start-screen__heroes';
  for (const hero of sortedHeroes) {
    grid.appendChild(createHeroOption(hero, renderOpponentSelection));
  }
  panel.appendChild(grid);
}

function renderOpponentSelection(playerHero) {
  const els = showStartOverlay();
  if (!els) return;
  const { panel } = els;
  panel.innerHTML = '';
  const title = document.createElement('h2');
  title.className = 'start-screen__title';
  const playerLabel = playerHero?.name ? String(playerHero.name) : 'your hero';
  title.textContent = `Choose an opponent for ${playerLabel}`;
  panel.appendChild(title);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'start-screen__back';
  back.textContent = 'Back';
  back.addEventListener('click', renderHeroSelection);
  panel.appendChild(back);
  if (!sortedHeroes.length) {
    const msg = document.createElement('p');
    msg.className = 'start-screen__message';
    msg.textContent = 'No heroes are available.';
    panel.appendChild(msg);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'start-screen__heroes';
  for (const hero of sortedHeroes) {
    grid.appendChild(createHeroOption(hero, (opponentHero) => {
      void beginGameWithHeroes(playerHero, opponentHero);
    }));
  }
  panel.appendChild(grid);
}

async function beginGameWithHeroes(playerHero, opponentHero) {
  const els = showStartOverlay();
  if (!els) return;
  const { panel } = els;
  panel.innerHTML = '';
  const status = document.createElement('p');
  status.className = 'start-screen__status';
  status.textContent = 'Preparing decks…';
  panel.appendChild(status);
  try {
    await ensurePrebuiltDecksLoaded();
    const playerDeck = buildDeckForHero(playerHero);
    const opponentDeck = buildDeckForHero(opponentHero);
    const deckOverride = {
      hero: playerDeck?.hero || null,
      cards: Array.isArray(playerDeck?.cards) ? playerDeck.cards.slice() : [],
    };
    if (!deckOverride.hero || deckOverride.cards.length !== 60) {
      throw new Error('Invalid deck for hero selection');
    }
    if (opponentDeck?.hero) {
      deckOverride.opponentHeroId = opponentDeck.hero.id;
      deckOverride.opponentHero = opponentDeck.hero;
      deckOverride.opponentDeck = {
        hero: opponentDeck.hero,
        cards: Array.isArray(opponentDeck.cards) ? opponentDeck.cards.slice() : [],
      };
    } else if (opponentHero?.id) {
      deckOverride.opponentHeroId = opponentHero.id;
      deckOverride.opponentHero = opponentHero;
    }
    autoSaveEnabled = true;
    await startNewGame({ deckOverride });
    try { saveLastDeck({ hero: deckOverride.hero, cards: deckOverride.cards }); } catch {}
    savedGameAvailable = true;
    rerender();
    hideStartScreen();
  } catch (err) {
    console.error('Failed to start selected game', err);
    savedGameAvailable = hasSavedGameState();
    renderStartHome('Unable to start a new game. Please try again.');
  }
}

function handleContinue() {
  const els = showStartOverlay();
  if (!els) return;
  const { panel } = els;
  panel.innerHTML = '';
  const status = document.createElement('p');
  status.className = 'start-screen__status';
  status.textContent = 'Loading saved game…';
  panel.appendChild(status);
  try {
    const ok = loadSavedGameState(game);
    if (ok) {
      autoSaveEnabled = true;
      rerender();
      hideStartScreen();
      resumeAiIfNeeded();
      savedGameAvailable = true;
      return;
    }
  } catch (err) {
    console.error('Failed to load saved game', err);
  }
  savedGameAvailable = hasSavedGameState();
  renderStartHome('No saved game was found.');
}

function generateRandomSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  const rand = typeof Math.random === 'function' ? Math.random() : 0;
  return Math.floor(rand * 0x100000000) >>> 0;
}

let autoSaveEnabled = true;

async function startNewGame({ deckOverride = null } = {}) {
  const seed = generateRandomSeed();
  if (typeof game?.rng?.seed === 'function') {
    game.rng.seed(seed);
  }
  let deck;
  if (deckOverride) {
    deck = {
      hero: deckOverride.hero || null,
      cards: Array.isArray(deckOverride.cards) ? deckOverride.cards.slice() : [],
    };
    if (deckOverride.opponentHeroId != null) deck.opponentHeroId = deckOverride.opponentHeroId;
    if (deckOverride.opponentHero) deck.opponentHero = deckOverride.opponentHero;
    if (deckOverride.opponentDeck) {
      deck.opponentDeck = {
        hero: deckOverride.opponentDeck.hero || null,
        cards: Array.isArray(deckOverride.opponentDeck.cards)
          ? deckOverride.opponentDeck.cards.slice()
          : [],
      };
    }
  } else {
    deck = deriveDeckFromGame(game);
  }
  clearSavedGameState();
  autoSaveEnabled = true;
  const hasDeck = deck?.hero && Array.isArray(deck.cards) && deck.cards.length === 60;
  await game.reset(hasDeck ? deck : null);
  saveGameState(game);
}

const rerender = () => {
  renderPlay(board, game, {
    onUpdate: rerender,
    onToggleDeckBuilder: toggleDeckBuilder,
    deckBuilderOpen,
    onNewGame: startNewGame
  });
  if (autoSaveEnabled) {
    saveGameState(game);
  }
};

rerender();

game.setUIRerender(rerender);

renderStartHome();

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

const deckState = { hero: null, cards: [], selectedPrebuiltDeck: null, selectedOpponentHeroId: null };

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

function handleSelectOpponentHero(heroId) {
  const normalized = heroId || null;
  if ((deckState.selectedOpponentHeroId || null) === normalized) return;
  deckState.selectedOpponentHeroId = normalized;
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
    onSelectOpponent: handleSelectOpponentHero,
  });
  updateUseDeckBtn();
};
function updateDeckBuilderButtonLabel() {
  const btn = document.querySelector('.btn-deck-builder');
  if (!btn) return;
  btn.textContent = deckBuilderOpen ? 'Back to game' : 'Deck Builder';
  btn.setAttribute('aria-pressed', deckBuilderOpen ? 'true' : 'false');
}

function closeDeckBuilder({ showGame = true } = {}) {
  deckBuilderOpen = false;
  deckRoot.style.display = 'none';
  sidebar.style.display = 'none';
  if (showGame) toggleGameVisible(true);
  updateDeckBuilderButtonLabel();
}

function openDeckBuilder() {
  // Show deck builder in sidebar and hide the game board
  // Load the active deck into the editor state
  deckBuilderOpen = true;
  try {
    const cur = deriveDeckFromGame(game);
    if (cur.hero) deckState.hero = cur.hero;
    deckState.cards = Array.isArray(cur.cards) ? Array.from(cur.cards) : [];
  } catch {}
  deckState.selectedPrebuiltDeck = null;
  deckRoot.style.display = 'block';
  sidebar.style.display = 'block';
  toggleGameVisible(false);
  updateDeckBuilderButtonLabel();
  rerenderDeck();
  ensurePrebuiltDecksLoaded();
}

function toggleDeckBuilder() {
  if (deckBuilderOpen) {
    closeDeckBuilder();
  } else {
    openDeckBuilder();
  }
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
  deckState.selectedOpponentHeroId = null;
  rerenderDeck();
});
useDeckBtn.addEventListener('click', async () => {
  if (useDeckBtn.disabled) return;
  closeDeckBuilder();
  clearSavedGameState();
  const deckPayload = { hero: deckState.hero, cards: deckState.cards };
  if (deckState.selectedOpponentHeroId) deckPayload.opponentHeroId = deckState.selectedOpponentHeroId;
  await game.reset(deckPayload);
  // Persist last used deck
  try { saveLastDeck({ hero: deckState.hero, cards: deckState.cards }); } catch {}
  saveGameState(game);
  rerender();
  // No RAF loop; state updates via DOM events
});
let logsOn = true;
renderOptions(optsRoot, { onReset: async () => { deckState.cards.length = 0; deckState.hero = null; deckState.selectedPrebuiltDeck = null; deckState.selectedOpponentHeroId = null; rerenderDeck(); clearSavedGameState(); await game.reset(); saveGameState(game); rerender(); } });

// Ensure logs mirror saved preference (defaults to false)
setDebugLogging(!!game.state?.debug);
