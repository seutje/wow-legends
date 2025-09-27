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
let availablePrebuiltDecks = [];
let prebuiltDecksPromise = null;
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

const startScreensRoot = (() => {
  if (typeof document === 'undefined') return null;
  const existing = document.querySelector('#start-screen-root');
  if (existing) return existing;
  const node = document.createElement('div');
  node.id = 'start-screen-root';
  node.setAttribute('aria-hidden', 'true');
  node.style.display = 'none';
  if (document.body) document.body.appendChild(node);
  return node;
})();

const startFlowState = {
  step: 'hidden',
  showContinue: !!loadedFromSave,
  allowCancel: !!loadedFromSave,
  selectedPlayerHeroId: null,
  selectedOpponentHeroId: null,
  origin: 'initial',
  error: null,
};

function generateRandomSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  const rand = typeof Math.random === 'function' ? Math.random() : 0;
  return Math.floor(rand * 0x100000000) >>> 0;
}

async function startNewGame({ deckOverride = null } = {}) {
  const seed = generateRandomSeed();
  if (typeof game?.rng?.seed === 'function') {
    game.rng.seed(seed);
  }
  const deck = deckOverride || deriveDeckFromGame(game);
  clearSavedGameState();
  let payload = null;
  if (deck?.hero && Array.isArray(deck.cards) && deck.cards.length === 60) {
    payload = {
      hero: deck.hero,
      cards: deck.cards.slice(),
    };
    if (deck.opponentHeroId) payload.opponentHeroId = deck.opponentHeroId;
    if (deck.opponentDeck) {
      const opp = deck.opponentDeck;
      const oppPayload = {};
      if (opp?.hero) oppPayload.hero = opp.hero;
      if (Array.isArray(opp?.cards)) oppPayload.cards = opp.cards.slice();
      if (oppPayload.hero || (Array.isArray(oppPayload.cards) && oppPayload.cards.length > 0)) {
        payload.opponentDeck = oppPayload;
      }
    }
  }
  await game.reset(payload);
  if (payload?.hero && Array.isArray(payload.cards) && payload.cards.length === 60) {
    try {
      saveLastDeck({ hero: payload.hero, cards: payload.cards });
    } catch {}
  }
  saveGameState(game);
}

const rerender = () => {
  renderPlay(board, game, {
    onUpdate: rerender,
    onToggleDeckBuilder: toggleDeckBuilder,
    deckBuilderOpen,
    onNewGame: (opts) => beginNewGameFlow({ ...(opts || {}), fromInGame: true })
  });
  saveGameState(game);
};

rerender();

game.setUIRerender(rerender);

function setStartScreenStep(step, updates = {}) {
  startFlowState.step = step;
  if (!('error' in updates)) startFlowState.error = null;
  Object.assign(startFlowState, updates);
  if (startScreensRoot) {
    renderStartScreens();
  }
}

function computeHeroDeckMap() {
  const map = new Map();
  const decks = Array.isArray(availablePrebuiltDecks) ? availablePrebuiltDecks : [];
  for (const deck of decks) {
    const hero = deck?.hero;
    if (!hero || hero.type !== 'hero' || !hero.id) continue;
    const cards = Array.isArray(deck.cards) ? deck.cards.slice() : [];
    if (cards.length !== 60) continue;
    if (!map.has(hero.id)) {
      map.set(hero.id, {
        hero,
        cards,
        name: deck.name || hero.name || hero.id,
      });
    }
  }
  return map;
}

function formatHeroSummary(hero) {
  if (!hero?.text) return '';
  const normalized = hero.text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
}

function createHeroOption(option, { onSelect, highlightSame } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'start-screen-hero';
  if (highlightSame && option.hero?.id === highlightSame) {
    btn.dataset.sameHero = '1';
  }
  btn.addEventListener('click', () => {
    if (typeof onSelect === 'function') onSelect(option.hero?.id);
  });
  if (option.hero?.id) {
    const art = new Image();
    art.loading = 'lazy';
    art.alt = option.hero.name;
    art.className = 'start-screen-hero-art';
    art.src = `src/assets/optim/${option.hero.id}-art.png`;
    art.onerror = () => {
      art.onerror = null;
      art.remove();
    };
    btn.appendChild(art);
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'start-screen-hero-name';
  nameEl.textContent = option.hero?.name || option.name || 'Unknown hero';
  btn.appendChild(nameEl);

  if (option.name && option.name !== option.hero?.name) {
    const deckEl = document.createElement('span');
    deckEl.className = 'start-screen-hero-deck';
    deckEl.textContent = option.name;
    btn.appendChild(deckEl);
  }

  const summary = formatHeroSummary(option.hero);
  if (summary) {
    const textEl = document.createElement('p');
    textEl.className = 'start-screen-hero-text';
    textEl.textContent = summary;
    btn.appendChild(textEl);
  }

  return btn;
}

function renderStartScreens() {
  if (!startScreensRoot) return;
  const hidden = startFlowState.step === 'hidden';
  startScreensRoot.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  if (hidden) {
    startScreensRoot.innerHTML = '';
    startScreensRoot.style.display = 'none';
    toggleGameVisible(true);
    return;
  }
  toggleGameVisible(false);
  startScreensRoot.style.display = 'flex';
  startScreensRoot.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'start-screen-panel';

  if (startFlowState.step === 'loading') {
    const title = document.createElement('h2');
    title.textContent = 'Preparing decks…';
    const msg = document.createElement('p');
    msg.textContent = 'Fetching prebuilt decks for each hero.';
    panel.append(title, msg);
  } else if (startFlowState.step === 'initial') {
    const title = document.createElement('h2');
    title.textContent = 'Welcome to WoW Legends';
    const msg = document.createElement('p');
    msg.textContent = 'Choose how you would like to begin your adventure.';
    const actions = document.createElement('div');
    actions.className = 'start-screen-actions';
    if (startFlowState.showContinue) {
      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', handleContinue);
      actions.appendChild(continueBtn);
    }
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.textContent = 'New Game';
    newBtn.addEventListener('click', () => beginNewGameFlow({ fromInGame: false }));
    actions.appendChild(newBtn);
    panel.append(title, msg, actions);
  } else if (startFlowState.step === 'hero') {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'start-screen-back';
    backBtn.textContent = startFlowState.origin === 'in-game' ? 'Cancel' : 'Back';
    backBtn.addEventListener('click', () => {
      if (startFlowState.origin === 'in-game') {
        setStartScreenStep('hidden', {
          allowCancel: true,
          showContinue: true,
          origin: 'in-game',
          selectedPlayerHeroId: null,
          selectedOpponentHeroId: null,
        });
      } else {
        setStartScreenStep('initial', {
          selectedPlayerHeroId: null,
          selectedOpponentHeroId: null,
        });
      }
    });
    const title = document.createElement('h2');
    title.textContent = 'Choose your hero';
    const msg = document.createElement('p');
    msg.textContent = 'Select a hero to lead your deck.';
    panel.append(backBtn, title, msg);

    const heroDeckMap = computeHeroDeckMap();
    const heroOptions = Array.from(heroDeckMap.values()).sort((a, b) => {
      const nameA = a.hero?.name || '';
      const nameB = b.hero?.name || '';
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    if (!heroOptions.length) {
      const emptyMsg = document.createElement('p');
      emptyMsg.textContent = 'No prebuilt decks are available right now. Start a random match instead?';
      const actions = document.createElement('div');
      actions.className = 'start-screen-actions';
      const randomBtn = document.createElement('button');
      randomBtn.type = 'button';
      randomBtn.textContent = 'Start Random Game';
      randomBtn.addEventListener('click', () => {
        startRandomGameFromStartScreen();
      });
      actions.appendChild(randomBtn);
      panel.append(emptyMsg, actions);
    } else {
      const grid = document.createElement('div');
      grid.className = 'start-screen-grid';
      heroOptions.forEach((option) => {
        grid.appendChild(createHeroOption(option, { onSelect: handleHeroSelection }));
      });
      panel.appendChild(grid);
    }
  } else if (startFlowState.step === 'opponent') {
    const heroDeckMap = computeHeroDeckMap();
    const playerOption = heroDeckMap.get(startFlowState.selectedPlayerHeroId);
    if (!playerOption) {
      setStartScreenStep('hero', { selectedOpponentHeroId: null });
      return;
    }
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'start-screen-back';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      setStartScreenStep('hero', { selectedOpponentHeroId: null });
    });
    const title = document.createElement('h2');
    title.textContent = 'Choose your opponent';
    const msg = document.createElement('p');
    msg.textContent = `You will play as ${playerOption.hero?.name || 'your hero'}. Pick an opponent to challenge.`;
    panel.append(backBtn, title, msg);

    const heroOptions = Array.from(heroDeckMap.values()).sort((a, b) => {
      const nameA = a.hero?.name || '';
      const nameB = b.hero?.name || '';
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
    const grid = document.createElement('div');
    grid.className = 'start-screen-grid';
    heroOptions.forEach((option) => {
      grid.appendChild(createHeroOption(option, {
        onSelect: handleOpponentSelection,
        highlightSame: playerOption.hero?.id,
      }));
    });
    const note = document.createElement('p');
    note.className = 'start-screen-note';
    note.textContent = 'Tip: Picking the same hero is allowed if you want a mirror match.';
    panel.append(grid, note);
  }

  if (startFlowState.error) {
    const errEl = document.createElement('p');
    errEl.className = 'start-screen-error';
    errEl.textContent = startFlowState.error;
    panel.appendChild(errEl);
  }

  startScreensRoot.appendChild(panel);
}

function handleHeroSelection(heroId) {
  if (!heroId) return;
  const map = computeHeroDeckMap();
  if (!map.has(heroId)) return;
  setStartScreenStep('opponent', {
    selectedPlayerHeroId: heroId,
    selectedOpponentHeroId: null,
  });
}

function handleOpponentSelection(heroId) {
  if (!heroId) return;
  finalizeNewGameSelection(heroId);
}

async function finalizeNewGameSelection(opponentHeroId) {
  const map = computeHeroDeckMap();
  const playerOption = map.get(startFlowState.selectedPlayerHeroId);
  const opponentOption = map.get(opponentHeroId);
  if (!playerOption || !opponentOption) {
    await startRandomGameFromStartScreen();
    return;
  }
  const payload = {
    hero: playerOption.hero,
    cards: playerOption.cards.slice(),
    opponentDeck: {
      hero: opponentOption.hero,
      cards: opponentOption.cards.slice(),
    },
  };
  try {
    await startNewGame({ deckOverride: payload });
    rerender();
    setStartScreenStep('hidden', {
      showContinue: true,
      allowCancel: true,
      origin: 'in-game',
      selectedPlayerHeroId: null,
      selectedOpponentHeroId: null,
    });
  } catch (err) {
    console.error('Failed to start selected decks', err);
    await startRandomGameFromStartScreen();
  }
}

async function startRandomGameFromStartScreen() {
  try {
    await startNewGame();
    rerender();
  } catch (err) {
    console.error('Failed to start random game', err);
  } finally {
    setStartScreenStep('hidden', {
      showContinue: true,
      allowCancel: true,
      origin: 'in-game',
      selectedPlayerHeroId: null,
      selectedOpponentHeroId: null,
    });
  }
}

function handleContinue() {
  setStartScreenStep('hidden', {
    showContinue: true,
    allowCancel: true,
    origin: 'in-game',
    selectedPlayerHeroId: null,
    selectedOpponentHeroId: null,
  });
  if (typeof rerender === 'function') rerender();
}

function openInitialStartScreen() {
  if (!startScreensRoot) return;
  const showContinue = !!(startFlowState.showContinue || loadedFromSave);
  const allowCancel = !!showContinue;
  setStartScreenStep('initial', {
    showContinue,
    allowCancel,
    origin: 'initial',
    selectedPlayerHeroId: null,
    selectedOpponentHeroId: null,
  });
}

async function beginNewGameFlow(options = {}) {
  const opts = options || {};
  const fromInGame = !!opts.fromInGame;
  const deckOverride = opts.deckOverride || null;

  if (deckOverride?.hero && Array.isArray(deckOverride.cards) && deckOverride.cards.length === 60) {
    try {
      await startNewGame({ deckOverride });
      rerender();
    } finally {
      setStartScreenStep('hidden', {
        showContinue: true,
        allowCancel: true,
        origin: 'in-game',
        selectedPlayerHeroId: null,
        selectedOpponentHeroId: null,
      });
    }
    return;
  }

  if (deckBuilderOpen) {
    closeDeckBuilder({ showGame: false });
  }

  const showContinue = fromInGame ? true : !!(startFlowState.showContinue || loadedFromSave);
  const baseUpdates = {
    origin: fromInGame ? 'in-game' : 'initial',
    allowCancel: fromInGame ? true : showContinue,
    showContinue,
    selectedPlayerHeroId: null,
    selectedOpponentHeroId: null,
  };

  const needsDecks = !Array.isArray(availablePrebuiltDecks) || availablePrebuiltDecks.length === 0;
  if (needsDecks) {
    setStartScreenStep('loading', baseUpdates);
    try {
      await ensurePrebuiltDecksLoaded();
    } catch (err) {
      console.error('Failed to load prebuilt decks', err);
      await startRandomGameFromStartScreen();
      return;
    }
  }

  if (!Array.isArray(availablePrebuiltDecks) || availablePrebuiltDecks.length === 0) {
    await startRandomGameFromStartScreen();
    return;
  }

  setStartScreenStep('hero', baseUpdates);
}

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

openInitialStartScreen();

// Ensure logs mirror saved preference (defaults to false)
setDebugLogging(!!game.state?.debug);
