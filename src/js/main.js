import Game from './game.js';
import { renderDeckBuilder } from './ui/deckbuilder.js';
import { renderOptions } from './ui/options.js';
import { setDebugLogging } from './utils/logger.js';
import { fillDeckRandomly } from './utils/deckbuilder.js';
import { RNG } from './utils/rng.js';
import { renderPlay } from './ui/play.js';
import { renderStartScreen, RANDOM_HERO_ID } from './ui/startScreen.js';
import { loadSettings, rehydrateDeck, saveLastDeck } from './utils/settings.js';
import { deriveDeckFromGame } from './utils/deckstate.js';
import { saveGameState, loadSavedGameState, clearSavedGameState } from './utils/savegame.js';

function qs(sel) { return document.querySelector(sel); }

function startLoadingOverlay(message = 'Loading game data…', options = null) {
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
  const opts = options && typeof options === 'object' ? options : {};
  const determinate = !!opts.determinate;
  if (determinate) {
    progressEl.dataset.mode = 'determinate';
    progressEl.style.setProperty('--progress-pos', '0');
  }
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
  let autoAnimate = !determinate;
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
    if (done || !autoAnimate) return;
    progressPos += direction * 0.012;
    if (progressPos >= max || progressPos <= min) {
      direction *= -1;
      progressPos = clamp(progressPos, min, max);
    }
    progressEl.style.setProperty('--progress-pos', progressPos.toFixed(4));
    frameId = schedule(step);
  };
  if (autoAnimate) frameId = schedule(step);

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
    setProgress(value) {
      if (!determinate || done) return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      autoAnimate = false;
      if (frameId) {
        cancel(frameId);
        frameId = 0;
      }
      const clamped = clamp(numeric, 0, 1);
      progressEl.style.setProperty('--progress-pos', clamped.toFixed(4));
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

const startScreenRoot = document.createElement('div');
startScreenRoot.id = 'start-screen';
if (mainEl) mainEl.appendChild(startScreenRoot);
else document.body.appendChild(startScreenRoot);

let availablePrebuiltDecks = [];
const startScreenState = {
  visible: false,
  step: 'initial',
  selectedHeroId: null,
  selectedOpponentHeroId: null,
  selectedPlayerDeck: null,
  selectedOpponentDeck: null,
  hasSavedGame: loadedFromSave,
  loadingDecks: false,
  pendingRandomSeed: null,
  pendingRandomRng: null,
};

function clearPendingRandomSelection() {
  startScreenState.pendingRandomSeed = null;
  startScreenState.pendingRandomRng = null;
}

function setHasSavedGame(value) {
  const normalized = !!value;
  if (startScreenState.hasSavedGame !== normalized) {
    startScreenState.hasSavedGame = normalized;
    if (startScreenState.visible) rerenderStartScreen();
  }
}

function getDeckForHero(heroId) {
  if (!heroId) return null;
  const pool = Array.isArray(availablePrebuiltDecks) ? availablePrebuiltDecks : [];
  return pool.find((deck) => deck?.hero?.id === heroId) || null;
}

function cloneDeck(deck) {
  if (!deck) return null;
  return {
    name: deck.name || null,
    hero: deck.hero || null,
    cards: Array.isArray(deck.cards) ? deck.cards.slice() : [],
  };
}

function selectRandomDeck({ excludeHeroIds = [], rng = null } = {}) {
  const pool = Array.isArray(availablePrebuiltDecks) ? availablePrebuiltDecks : [];
  if (!pool.length) return null;
  const exclude = new Set((excludeHeroIds || []).filter(Boolean));
  const filtered = pool.filter((deck) => deck?.hero?.id && !exclude.has(deck.hero.id));
  const candidates = filtered.length ? filtered : pool.filter((deck) => deck?.hero?.id);
  if (!candidates.length) return null;
  let index = 0;
  const seededRng = rng && typeof rng.randomInt === 'function'
    ? rng
    : (game?.rng && typeof game.rng.randomInt === 'function' ? game.rng : null);
  if (seededRng) index = seededRng.randomInt(0, candidates.length);
  else index = Math.floor(Math.random() * candidates.length);
  const selected = candidates[index] || null;
  if (!selected) return null;
  return cloneDeck(selected);
}

function preloadCardArt(card) {
  if (!card || !card.id || typeof Image === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const img = new Image();
    let resolved = false;
    let triedOptim = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    img.onload = cleanup;
    img.onerror = () => {
      if (!triedOptim) {
        triedOptim = true;
        img.src = `src/assets/art/${card.id}-art.png`;
      } else {
        cleanup();
      }
    };
    try {
      img.src = `src/assets/optim/${card.id}-art.png`;
    } catch {
      cleanup();
    }
  });
}

function collectInitialDeckCards(deckOverride) {
  if (!deckOverride) return [];
  const cards = [];
  const seen = new Set();
  const addCard = (card) => {
    if (!card || !card.id || seen.has(card.id)) return;
    seen.add(card.id);
    cards.push(card);
  };
  const playerCards = Array.isArray(deckOverride.cards) ? deckOverride.cards.slice(0, 4) : [];
  for (const card of playerCards) addCard(card);
  let opponentDeck = deckOverride.opponentDeck || null;
  if (!opponentDeck && deckOverride.opponentHeroId) {
    opponentDeck = getDeckForHero(deckOverride.opponentHeroId);
  }
  const opponentCards = Array.isArray(opponentDeck?.cards) ? opponentDeck.cards.slice(0, 4) : [];
  for (const card of opponentCards) addCard(card);
  return cards;
}

async function preloadCardArtList(cards, { onCardLoaded = null } = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  await Promise.all(cards.map((card) => (
    preloadCardArt(card)
      .catch(() => {})
      .finally(() => { if (typeof onCardLoaded === 'function') onCardLoaded(); })
  )));
}

function rerenderStartScreen() {
  const hasExplicitDeck = !!startScreenState.selectedPlayerDeck;
  const resolvedPlayerDeck = hasExplicitDeck
    ? startScreenState.selectedPlayerDeck
    : (startScreenState.selectedHeroId && startScreenState.selectedHeroId !== RANDOM_HERO_ID
      ? getDeckForHero(startScreenState.selectedHeroId)
      : null);
  renderStartScreen(startScreenRoot, {
    visible: startScreenState.visible,
    step: startScreenState.step,
    hasSavedGame: startScreenState.hasSavedGame,
    decks: availablePrebuiltDecks,
    selectedHeroId: startScreenState.selectedHeroId,
    loadingDecks: startScreenState.loadingDecks,
    onContinue: () => { hideStartScreen(); },
    onRequestNewGame: () => { openHeroSelection(); },
    onSelectHero: (hero) => { handleHeroSelection(hero); },
    onSelectOpponent: (hero) => { handleOpponentSelection(hero); },
    onBack: (target) => { handleStartScreenBack(target); },
    opponentContext: {
      playerHeroName: resolvedPlayerDeck?.hero?.name || null,
      selectedOpponentId: startScreenState.selectedOpponentHeroId,
    },
  });
}

function hideStartScreen() {
  if (!startScreenState.visible) return;
  startScreenState.visible = false;
  startScreenState.step = 'initial';
  startScreenState.selectedHeroId = null;
  startScreenState.selectedOpponentHeroId = null;
  startScreenState.selectedPlayerDeck = null;
  startScreenState.selectedOpponentDeck = null;
  clearPendingRandomSelection();
  toggleGameVisible(true);
  rerenderStartScreen();
}

function showInitialStartScreen() {
  startScreenState.visible = true;
  startScreenState.step = 'initial';
  startScreenState.selectedHeroId = null;
  startScreenState.selectedOpponentHeroId = null;
  startScreenState.selectedPlayerDeck = null;
  startScreenState.selectedOpponentDeck = null;
  clearPendingRandomSelection();
  toggleGameVisible(false);
  rerenderStartScreen();
}

async function openHeroSelection() {
  startScreenState.visible = true;
  startScreenState.step = 'hero';
  startScreenState.selectedHeroId = null;
  startScreenState.selectedOpponentHeroId = null;
  startScreenState.selectedPlayerDeck = null;
  startScreenState.selectedOpponentDeck = null;
  startScreenState.loadingDecks = !Array.isArray(availablePrebuiltDecks) || availablePrebuiltDecks.length === 0;
  clearPendingRandomSelection();
  toggleGameVisible(false);
  rerenderStartScreen();
  if (startScreenState.loadingDecks) {
    try {
      await ensurePrebuiltDecksLoaded();
    } finally {
      startScreenState.loadingDecks = false;
      rerenderStartScreen();
    }
  }
}

async function openOpponentSelection() {
  if (!startScreenState.selectedHeroId) return;
  startScreenState.visible = true;
  startScreenState.step = 'opponent';
  startScreenState.selectedOpponentHeroId = null;
  startScreenState.selectedOpponentDeck = null;
  startScreenState.loadingDecks = !Array.isArray(availablePrebuiltDecks) || availablePrebuiltDecks.length === 0;
  toggleGameVisible(false);
  rerenderStartScreen();
  if (startScreenState.loadingDecks) {
    try {
      await ensurePrebuiltDecksLoaded();
    } finally {
      startScreenState.loadingDecks = false;
      rerenderStartScreen();
    }
  }
}

function handleHeroSelection(hero) {
  if (!hero) return;
  const isRandom = hero.id === RANDOM_HERO_ID || hero.isRandomOption;
  if (isRandom) {
    const seed = generateRandomSeed();
    const rng = new RNG(seed);
    const randomDeck = selectRandomDeck({ rng });
    if (!randomDeck) return;
    startScreenState.selectedHeroId = RANDOM_HERO_ID;
    startScreenState.selectedPlayerDeck = randomDeck;
    startScreenState.pendingRandomSeed = seed;
    startScreenState.pendingRandomRng = rng;
    startScreenState.selectedOpponentHeroId = null;
    startScreenState.selectedOpponentDeck = null;
    openOpponentSelection();
    return;
  }
  if (!hero.id) return;
  clearPendingRandomSelection();
  const deck = getDeckForHero(hero.id);
  if (!deck) return;
  startScreenState.selectedHeroId = hero.id;
  startScreenState.selectedPlayerDeck = deck;
  startScreenState.selectedOpponentHeroId = null;
  startScreenState.selectedOpponentDeck = null;
  openOpponentSelection();
}

async function handleOpponentSelection(hero) {
  if (!hero || !hero.id) return;
  const playerDeck = startScreenState.selectedPlayerDeck
    || (startScreenState.selectedHeroId && startScreenState.selectedHeroId !== RANDOM_HERO_ID
      ? getDeckForHero(startScreenState.selectedHeroId)
      : null);
  if (!playerDeck || !playerDeck.hero) return;
  const isRandom = hero.id === RANDOM_HERO_ID || hero.isRandomOption;
  let opponentDeck = null;
  if (isRandom) {
    let rng = startScreenState.pendingRandomRng;
    if (!rng || typeof rng.randomInt !== 'function') {
      const seed = startScreenState.pendingRandomSeed ?? generateRandomSeed();
      startScreenState.pendingRandomSeed = seed;
      rng = new RNG(seed);
      startScreenState.pendingRandomRng = rng;
    }
    opponentDeck = selectRandomDeck({ excludeHeroIds: [playerDeck.hero.id], rng })
      || selectRandomDeck({ rng });
    startScreenState.selectedOpponentHeroId = RANDOM_HERO_ID;
  } else {
    if (!startScreenState.pendingRandomSeed) clearPendingRandomSelection();
    opponentDeck = getDeckForHero(hero.id);
    startScreenState.selectedOpponentHeroId = hero.id;
  }
  startScreenState.selectedOpponentDeck = opponentDeck || null;
  const deckOverride = {
    hero: playerDeck.hero,
    cards: Array.isArray(playerDeck.cards) ? playerDeck.cards.slice() : [],
  };
  const opponentHeroId = opponentDeck?.hero?.id;
  if (opponentDeck && opponentHeroId) {
    deckOverride.opponentHeroId = opponentHeroId;
    deckOverride.opponentDeck = {
      hero: opponentDeck.hero,
      cards: Array.isArray(opponentDeck.cards) ? opponentDeck.cards.slice() : [],
    };
  } else if (!isRandom && hero.id) {
    deckOverride.opponentHeroId = hero.id;
  }
  if (!deckOverride.opponentHeroId) {
    deckOverride.opponentHeroId = opponentHeroId || playerDeck.hero.id;
  }
  const previousState = {
    selectedHeroId: startScreenState.selectedHeroId,
    selectedPlayerDeck: startScreenState.selectedPlayerDeck,
    selectedOpponentHeroId: startScreenState.selectedOpponentHeroId,
    selectedOpponentDeck: startScreenState.selectedOpponentDeck,
    pendingRandomSeed: startScreenState.pendingRandomSeed,
    pendingRandomRng: startScreenState.pendingRandomRng,
  };
  startScreenState.visible = false;
  rerenderStartScreen();
  toggleGameVisible(true);
  const preloadCards = collectInitialDeckCards(deckOverride);
  const totalSteps = preloadCards.length + 1;
  let completed = 0;
  const overlay = startLoadingOverlay('Preparing decks…', { determinate: true });
  const updateProgress = () => {
    if (!overlay || typeof overlay.setProgress !== 'function') return;
    const ratio = totalSteps > 0 ? (completed / totalSteps) : 1;
    overlay.setProgress(ratio);
  };
  updateProgress();
  try {
    await preloadCardArtList(preloadCards, {
      onCardLoaded: () => {
        completed += 1;
        updateProgress();
      },
    });
    const seed = startScreenState.pendingRandomSeed;
    await startNewGame(seed != null ? { deckOverride, seed } : { deckOverride });
    completed += 1;
    updateProgress();
    overlay?.finish(true);
    hideStartScreen();
  } catch {
    overlay?.finish(false);
    startScreenState.visible = true;
    startScreenState.step = 'opponent';
    startScreenState.selectedHeroId = previousState.selectedHeroId;
    startScreenState.selectedPlayerDeck = previousState.selectedPlayerDeck;
    startScreenState.selectedOpponentHeroId = previousState.selectedOpponentHeroId;
    startScreenState.selectedOpponentDeck = previousState.selectedOpponentDeck;
    startScreenState.pendingRandomSeed = previousState.pendingRandomSeed;
    startScreenState.pendingRandomRng = previousState.pendingRandomRng;
    startScreenState.loadingDecks = false;
    toggleGameVisible(false);
    rerenderStartScreen();
  }
}

function handleStartScreenBack(target) {
  if (target === 'hero') {
    openHeroSelection();
  } else if (target === 'initial') {
    showInitialStartScreen();
  } else if (target === 'close') {
    hideStartScreen();
  }
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

async function startNewGame({ deckOverride = null, seed: providedSeed = null } = {}) {
  const parsedSeed = Number(providedSeed);
  const hasSeedOverride = Number.isFinite(parsedSeed);
  const seed = hasSeedOverride ? (parsedSeed >>> 0) : generateRandomSeed();
  if (typeof game?.rng?.seed === 'function') {
    game.rng.seed(seed);
  }
  const deck = deckOverride || deriveDeckFromGame(game);
  setHasSavedGame(false);
  clearSavedGameState();
  const hasDeck = deck?.hero && Array.isArray(deck.cards) && deck.cards.length === 60;
  await game.reset(hasDeck ? deck : null);
  saveGameState(game);
  setHasSavedGame(true);
}

async function handleNewGameRequest(options = null) {
  if (options?.deckOverride) {
    await startNewGame(options);
    hideStartScreen();
    return;
  }
  if (deckBuilderOpen) {
    closeDeckBuilder({ showGame: false });
  }
  await openHeroSelection();
}

const rerender = () => {
  renderPlay(board, game, {
    onUpdate: rerender,
    onToggleDeckBuilder: toggleDeckBuilder,
    deckBuilderOpen,
    onNewGame: handleNewGameRequest
  });
  saveGameState(game);
};

rerender();

game.setUIRerender(rerender);

showInitialStartScreen();

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
useDeckBtn.className = 'button-pill button-pill--primary deckbuilder-button deckbuilder-button--apply';
const fillRandomBtn = document.createElement('button');
fillRandomBtn.textContent = 'Fill Random';
fillRandomBtn.className = 'button-pill button-pill--secondary deckbuilder-button deckbuilder-button--fill';
const clearDeckBtn = document.createElement('button');
clearDeckBtn.textContent = 'Clear Deck';
clearDeckBtn.className = 'button-pill button-pill--secondary deckbuilder-button deckbuilder-button--clear';
sidebar.append(useDeckBtn, fillRandomBtn, clearDeckBtn);
sidebar.appendChild(deckRoot);
const optsRoot = document.createElement('div');
sidebar.appendChild(optsRoot);
if (!sidebar.parentElement) root.appendChild(sidebar);
// Hide aside by default; only visible while deck builder is open
sidebar.style.display = 'none';

const deckState = { hero: null, cards: [], selectedPrebuiltDeck: null, selectedOpponentHeroId: null };
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
      rerenderStartScreen();
    } catch {
      availablePrebuiltDecks = [];
      rerenderStartScreen();
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
  setHasSavedGame(false);
  clearSavedGameState();
  const deckPayload = { hero: deckState.hero, cards: deckState.cards };
  if (deckState.selectedOpponentHeroId) deckPayload.opponentHeroId = deckState.selectedOpponentHeroId;
  await game.reset(deckPayload);
  // Persist last used deck
  try { saveLastDeck({ hero: deckState.hero, cards: deckState.cards }); } catch {}
  saveGameState(game);
  setHasSavedGame(true);
  rerender();
  // No RAF loop; state updates via DOM events
});
let logsOn = true;
renderOptions(optsRoot, {
  onReset: async () => {
    deckState.cards.length = 0;
    deckState.hero = null;
    deckState.selectedPrebuiltDeck = null;
    deckState.selectedOpponentHeroId = null;
    rerenderDeck();
    setHasSavedGame(false);
    clearSavedGameState();
    await game.reset();
    saveGameState(game);
    setHasSavedGame(true);
    rerender();
  }
});

// Ensure logs mirror saved preference (defaults to false)
setDebugLogging(!!game.state?.debug);
