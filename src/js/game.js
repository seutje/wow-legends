// Orchestrates core game lifecycle and a minimal playable engine.
import Player from './entities/player.js';
import Card from './entities/card.js';
import TurnSystem from './systems/turns.js';
import ResourceSystem from './systems/resources.js';
import CombatSystem from './systems/combat.js';
import EffectSystem from './systems/effects.js';
import { validateCardData } from './systems/content.js';
import { RNG } from './utils/rng.js';
import Hero from './entities/hero.js';
import { renderBoard } from './ui/board.js';
import QuestSystem from './systems/quests.js';
import { EventBus } from './utils/events.js';
import { selectTargets } from './systems/targeting.js';
import { logSecretTriggered } from './utils/combatLog.js';
import { fillDeckRandomly } from './utils/deckbuilder.js';
import { getCardInstanceId, matchesCardIdentifier } from './utils/card.js';
import { chooseStartingPlayerKey } from './utils/turnOrder.js';

const DEFAULT_AI_ACTION_DELAY_MS = 1000;

function buildDeckFromTemplate(template, cardById) {
  if (!template || typeof template !== 'object') return null;
  if (!(cardById instanceof Map)) return null;
  const heroData = template.heroId ? cardById.get(template.heroId) : null;
  if (!heroData || heroData.type !== 'hero') return null;
  const sourceCards = Array.isArray(template.cards) ? template.cards : [];
  const counts = new Map();
  const equipmentIds = new Set();
  const cards = [];
  for (const cardId of sourceCards) {
    const cardData = cardById.get(cardId);
    if (!cardData || cardData.type === 'hero') continue;
    if (cardData.type === 'quest') return null;
    const current = counts.get(cardData.id) || 0;
    if (current >= 3) return null;
    counts.set(cardData.id, current + 1);
    if (cardData.type === 'equipment') equipmentIds.add(cardData.id);
    cards.push(cardData);
  }
  if (cards.length !== sourceCards.length) return null;
  if (cards.length !== 60) return null;
  let allyCount = 0;
  for (const c of cards) {
    if (c.type === 'ally') allyCount += 1;
  }
  if (allyCount < 30) return null;
  if (equipmentIds.size > 1) return null;
  return { hero: heroData, cards, name: template.name || null };
}

function effectListDealsDamageToOthers(effects) {
  if (!Array.isArray(effects)) return false;
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') continue;
    if (effect.type === 'damage') {
      const baseAmount = typeof effect.amount === 'number' ? effect.amount : 0;
      const comboAmount = typeof effect.comboAmount === 'number' ? effect.comboAmount : 0;
      if ((baseAmount > 0 || comboAmount > 0) && effect.target !== 'selfHero') {
        return true;
      }
    }
    if (effect.type === 'chooseOne') {
      const options = Array.isArray(effect.options) ? effect.options : [];
      if (options.some((opt) => effectListDealsDamageToOthers(opt?.effects))) {
        return true;
      }
    }
    if (Array.isArray(effect.effects) && effectListDealsDamageToOthers(effect.effects)) {
      return true;
    }
  }
  return false;
}

export default class Game {
  constructor(rootEl, opts = {}) {
    this.rootEl = rootEl;
    this.opts = opts;
    const aiHint = opts?.aiPlayers;
    let aiList;
    if (Array.isArray(aiHint)) aiList = aiHint;
    else if (aiHint instanceof Set) aiList = Array.from(aiHint);
    else if (typeof aiHint === 'string') aiList = [aiHint];
    else aiList = (typeof window === 'undefined') ? ['player', 'opponent'] : ['opponent'];
    this.aiPlayers = new Set(aiList.filter((p) => p === 'player' || p === 'opponent'));
    this._isBrowserEnv = typeof window !== 'undefined' && typeof document !== 'undefined';
    const rawDelay = Number.isFinite(opts?.aiActionDelayMs)
      ? Math.max(0, opts.aiActionDelayMs)
      : DEFAULT_AI_ACTION_DELAY_MS;
    this._aiActionDelayMs = rawDelay;
    this._shouldThrottleAI = !!rootEl && this._isBrowserEnv;
    this.running = false;
    this._raf = 0;
    this._lastTs = 0;
    // Sentinel for UI prompt cancellation
    this.CANCEL = Symbol('CANCEL');

    // Systems
    this.turns = new TurnSystem();
    this.resources = new ResourceSystem(this.turns);
    // Create the event bus before systems that depend on it
    this.bus = new EventBus();
    this.combat = new CombatSystem(this.bus);
    this.effects = new EffectSystem(this);
    const rawSeed = opts?.seed;
    if (rawSeed != null) {
      const parsedSeed = Number(rawSeed);
      if (Number.isFinite(parsedSeed)) {
        this.rng = new RNG(parsedSeed >>> 0);
      }
    }
    // Use deterministic RNG in tests/node to stabilize content selection
    if (!this.rng) {
      if (typeof window === 'undefined') {
        this.rng = new RNG(0xC0FFEE);
      } else {
        this.rng = new RNG();
      }
    }
    this.quests = new QuestSystem(this);

      this.turns.bus.on('turn:start', ({ player }) => {
        if (player) {
          player.cardsPlayedThisTurn = 0;
          player.armorGainedThisTurn = 0;
        }
        const bonus = player?.hero?.data?.nextSpellDamageBonus;
        if (bonus?.eachTurn) bonus.used = false;
        if (player?.hero) {
          player.hero.powerUsed = false;
          // Reset per-turn attack state
          player.hero.data.attacked = false;
          player.hero.data.attacksUsed = 0;
          player.hero.data.summoningSick = false;
          for (const c of player.battlefield.cards) {
            if (c.data) {
              c.data.attacked = false;
              c.data.attacksUsed = 0;
              c.data.summoningSick = false;
            }
          }
          if (player.hero.passive?.length) {
            this.effects.execute(player.hero.passive, { game: this, player, card: player.hero });
          }
        }
        const difficulty = this.state?.difficulty || this._defaultDifficulty;
        const opponentIsAI = typeof this.aiPlayers?.has === 'function' && this.aiPlayers.has('opponent');
        const aiHandlesDraw = opponentIsAI
          && player === this.opponent
          && (difficulty === 'medium' || difficulty === 'hard' || difficulty === 'nightmare' || difficulty === 'hybrid');
        if (player && !aiHandlesDraw) this.draw(player, 1);
      });

      this.turns.bus.on('phase:end', ({ phase }) => {
        if (phase === 'End') {
          const p = this.turns.activePlayer;
          if (p) {
            const all = [p.hero, ...p.battlefield.cards];
            for (const c of all) {
              const ft = c?.data?.freezeTurns || 0;
              if (ft > 0) c.data.freezeTurns = ft - 1;
            }
          }
        }
      });

    // Players
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });

    this._defaultDifficulty = this._isBrowserEnv ? 'nightmare' : 'easy';
    this.state = { frame: 0, startedAt: 0, difficulty: this._defaultDifficulty, debug: false, matchOver: false, winner: null };
    this._nnModelPromise = null;
    this._aiDeckTemplates = null;
    this._playerDeckTemplates = null;
    this._cardIndex = null;
    this._actionTargetStack = [];
    this._pendingTurnIncrement = false;
    this._skipNextTurnAdvance = false;
  }

  setUIRerender(fn) {
    this._uiRerender = fn;
  }

  _playerRole(player) {
    if (!player) return null;
    if (player === this.player) return 'player';
    if (player === this.opponent) return 'opponent';
    return null;
  }

  _isAIControlled(player) {
    const role = this._playerRole(player);
    if (!role) return false;
    const pool = this.aiPlayers;
    if (!pool || typeof pool.has !== 'function') return false;
    return pool.has(role);
  }

  _isParticipant(player) {
    return player === this.player || player === this.opponent;
  }

  _currentHealth(hero) {
    if (!hero) return null;
    if (hero?.data && typeof hero.data.health === 'number') return hero.data.health;
    if (typeof hero?.health === 'number') return hero.health;
    return null;
  }

  _isHeroDefeated(hero) {
    const health = this._currentHealth(hero);
    return typeof health === 'number' && health <= 0;
  }

  checkForGameOver() {
    const playerDead = this._isHeroDefeated(this.player?.hero);
    const opponentDead = this._isHeroDefeated(this.opponent?.hero);
    const ended = playerDead || opponentDead;
    if (!ended) return false;
    if (this.state && !this.state.matchOver) {
      this.state.matchOver = true;
      if (playerDead && opponentDead) this.state.winner = 'draw';
      else if (playerDead) this.state.winner = 'opponent';
      else this.state.winner = 'player';
      try {
        this.bus.emit('game:over', {
          player: this.player,
          opponent: this.opponent,
          playerDead,
          opponentDead,
          winner: this.state.winner,
        });
      } catch {}
    }
    return true;
  }

  isGameOver() {
    if (this.state?.matchOver) return true;
    return this.checkForGameOver();
  }

  async throttleAIAction(player) {
    if (!this._shouldThrottleAI) return;
    if (!this._isAIControlled(player)) return;
    const delay = this._aiActionDelayMs;
    if (!(delay > 0)) return;
    await new Promise((resolve) => {
      if (typeof globalThis === 'object' && typeof globalThis.setTimeout === 'function') {
        globalThis.setTimeout(resolve, delay);
      } else if (typeof setTimeout === 'function') {
        setTimeout(resolve, delay);
      } else {
        resolve();
      }
    });
  }

  _closeActionTargetScope({ discard = false } = {}) {
    if (!Array.isArray(this._actionTargetStack) || this._actionTargetStack.length === 0) {
      return [];
    }
    const scope = this._actionTargetStack.pop();
    if (!(scope instanceof Set) || discard) return [];
    return Array.from(scope);
  }

  _pushActionTargetScope() {
    if (!Array.isArray(this._actionTargetStack)) this._actionTargetStack = [];
    const scope = new Set();
    this._actionTargetStack.push(scope);
    let closed = false;
    return ({ discard = false } = {}) => {
      if (closed) return [];
      closed = true;
      return this._closeActionTargetScope({ discard });
    };
  }

  recordActionTarget(target) {
    if (!target) return;
    if (!Array.isArray(this._actionTargetStack) || this._actionTargetStack.length === 0) return;
    const current = this._actionTargetStack[this._actionTargetStack.length - 1];
    if (current instanceof Set) current.add(target);
  }

  _formatLogWithTargets(base, targets, { preposition = 'targeting' } = {}) {
    const list = Array.isArray(targets) ? targets : [];
    const names = [];
    const seen = new Set();
    for (const t of list) {
      const name = (typeof t?.name === 'string') ? t.name.trim() : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    if (names.length === 0) return base;
    let formatted;
    if (names.length === 1) formatted = names[0];
    else if (names.length === 2) formatted = `${names[0]} and ${names[1]}`;
    else formatted = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    const connector = preposition ? ` ${preposition} ` : ' ';
    return `${base}${connector}${formatted}`;
  }

  _shouldObscureSecretLog(player, card) {
    if (!player || !card) return false;
    if (this.state?.debug) return false;
    if (player === this.player) return false;
    if (!this._isAIControlled(player)) return false;
    const keywords = Array.isArray(card.keywords) ? card.keywords : [];
    return keywords.some((kw) => typeof kw === 'string' && kw.toLowerCase() === 'secret');
  }

  async init() {
    if (this.rootEl && !this.rootEl.dataset.bound) {
      // No start button; avoid showing an initialization prompt
      this.rootEl.innerHTML = '';
      this.rootEl.dataset.bound = '1';
    }
    await this.setupMatch();
  }

  async setupMatch(playerDeck = null) {
    // Load initial libraries from card data
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const types = ['hero', 'spell', 'ally', 'equipment', 'quest', 'consumable'];
      const chunks = [];
      for (const t of types) {
        try {
          const p = new URL(`../../data/cards/${t}.json`, import.meta.url);
          const txt = await fs.readFile(p, 'utf8');
          chunks.push(JSON.parse(txt));
        } catch (err) {
          // Missing type file is allowed; continue
        }
      }
      this.allCards = chunks.flat();
    } else {
      const mk = (name) => fetch(new URL(`../../data/cards/${name}.json`, import.meta.url)).catch(() => null);
      const [h, s, a, e, q, c] = await Promise.all([
        mk('hero'), mk('spell'), mk('ally'), mk('equipment'), mk('quest'), mk('consumable')
      ]);
      const parts = [];
      for (const r of [h, s, a, e, q, c]) {
        if (r && r.ok) {
          try { parts.push(await r.json()); } catch {}
        }
      }
      this.allCards = parts.flat();
    }

    const heroes = this.allCards.filter(c => c.type === 'hero');
    const otherCards = this.allCards.filter(c => c.type !== 'hero');
    const nonQuestCards = otherCards.filter(c => c.type !== 'quest');
    const cardById = new Map(this.allCards.map((card) => [card.id, card]));
    this._cardIndex = cardById;
    this._playerDeckTemplates = null;
    this._pendingTurnIncrement = false;

    const rng = this.rng;
    const createRandomDeckState = (excludeHeroId = null) => {
      const state = { hero: null, cards: [] };
      fillDeckRandomly(state, this.allCards, rng);
      const heroMatchesExclude = excludeHeroId && state.hero && state.hero.id === excludeHeroId;
      if ((!state.hero || heroMatchesExclude) && heroes.length > 0) {
        const pool = heroes.filter((hero) => !excludeHeroId || hero.id !== excludeHeroId);
        if (pool.length > 0) {
          state.hero = rng.pick(pool);
          state.cards.length = 0;
          fillDeckRandomly(state, this.allCards, rng);
        }
      }
      return state;
    };

    const aiPlayers = this.aiPlayers instanceof Set ? this.aiPlayers : new Set();
    const playerIsAI = aiPlayers.has('player');
    const opponentIsAI = aiPlayers.has('opponent');

    let prebuiltDeckPool = [];
    if (playerIsAI || opponentIsAI) {
      try {
        const templates = await this._loadAIDeckTemplates();
        if (Array.isArray(templates) && templates.length > 0) {
          prebuiltDeckPool = templates.map((template) => buildDeckFromTemplate(template, cardById)).filter(Boolean);
          if (prebuiltDeckPool.length > 0) {
            this._playerDeckTemplates = prebuiltDeckPool.map((deck) => ({
              hero: deck.hero,
              cards: deck.cards.slice(),
              name: deck.name || null,
            }));
          }
        }
      } catch {
        prebuiltDeckPool = [];
      }
    }

    const pickPrebuiltDeck = (excludeHeroId = null) => {
      if (!prebuiltDeckPool.length) return null;
      let pool = prebuiltDeckPool;
      if (excludeHeroId) {
        pool = prebuiltDeckPool.filter((deck) => deck.hero?.id !== excludeHeroId);
        if (pool.length === 0) return null;
      }
      const rngSource = (this.rng && typeof this.rng.randomInt === 'function') ? this.rng : null;
      let index = 0;
      if (rngSource) index = rngSource.randomInt(0, pool.length);
      else index = Math.floor(Math.random() * pool.length);
      const selected = pool[index];
      if (!selected) return null;
      return {
        hero: selected.hero,
        cards: Array.isArray(selected.cards) ? selected.cards.slice() : [],
        name: selected.name || null,
      };
    };
    const buildLibraryData = (cards, allowQuest) => {
      const sanitized = [];
      if (Array.isArray(cards)) {
        for (const cardData of cards) {
          if (!cardData) continue;
          if (!allowQuest && cardData.type === 'quest') continue;
          sanitized.push(cardData);
        }
      }
      const pool = allowQuest ? otherCards : nonQuestCards;
      while (sanitized.length < 60 && pool.length > 0) {
        sanitized.push(rng.pick(pool));
      }
      if (sanitized.length > 60) sanitized.length = 60;
      return sanitized;
    };

    // Clear previous zones
    this.player.hand.cards = [];
    this.player.battlefield.cards = [];
    this.opponent.hand.cards = [];
    this.opponent.battlefield.cards = [];

    // Assign player hero and library
    if (playerDeck?.hero && playerDeck.cards?.length === 60) {
      validateCardData(playerDeck.hero);
      this.player.hero = new Hero(playerDeck.hero);
      // Ensure ownership is set for systems that depend on it (e.g., combat reflection)
      this.player.hero.owner = this.player;
      const playerLibData = buildLibraryData(playerDeck.cards, !playerIsAI);
      this.player.library.cards = [];
      for (const cardData of playerLibData) {
        validateCardData(cardData);
        this.player.library.add(new Card(cardData));
      }
    } else {
      let playerDeckState = null;
      if (playerIsAI || (this._isBrowserEnv && prebuiltDeckPool.length > 0)) {
        playerDeckState = pickPrebuiltDeck();
      }
      if (!playerDeckState) {
        playerDeckState = createRandomDeckState();
      }
      let playerHeroData = playerDeckState.hero;
      if (!playerHeroData && heroes.length > 0) {
        playerHeroData = rng.pick(heroes);
      }
      if (playerHeroData) {
        playerDeckState.hero = playerHeroData;
        validateCardData(playerHeroData);
        this.player.hero = new Hero(playerHeroData);
        this.player.hero.owner = this.player;
      }
      let playerCards = Array.isArray(playerDeckState.cards) ? playerDeckState.cards : [];
      if (playerCards.length !== 60 && playerDeckState.hero) {
        playerDeckState.cards = [];
        fillDeckRandomly(playerDeckState, this.allCards, rng);
        playerCards = Array.isArray(playerDeckState.cards) ? playerDeckState.cards : [];
      }
      if (playerCards.length === 0) {
        playerCards = buildLibraryData(null, !playerIsAI);
      }
      this.player.library.cards = [];
      for (const cardData of playerCards) {
        validateCardData(cardData);
        this.player.library.add(new Card(cardData));
      }
    }

    // Assign opponent hero and library
    let opponentDeckState = null;
    if (opponentIsAI) {
      opponentDeckState = pickPrebuiltDeck(this.player.hero?.id);
    }
    if (!opponentDeckState) {
      opponentDeckState = createRandomDeckState(this.player.hero?.id);
    }
    let opponentHeroData = opponentDeckState.hero;
    if (!opponentHeroData && heroes.length > 0) {
      opponentHeroData = rng.pick(heroes);
    }
    if (opponentHeroData && this.player?.hero) {
      const guardLimit = heroes.length > 0 ? heroes.length * 3 : 0;
      let guard = 0;
      while (this.player.hero && opponentHeroData?.id === this.player.hero.id && guard < guardLimit) {
        opponentHeroData = rng.pick(heroes);
        guard += 1;
      }
    }
    if (opponentHeroData) {
      opponentDeckState.hero = opponentHeroData;
      validateCardData(opponentHeroData);
      this.opponent.hero = new Hero(opponentHeroData);
      this.opponent.hero.owner = this.opponent;
    }
    let opponentCards = Array.isArray(opponentDeckState.cards) ? opponentDeckState.cards : [];
    if (opponentCards.length !== 60 && opponentDeckState.hero) {
      opponentDeckState.cards = [];
      fillDeckRandomly(opponentDeckState, this.allCards, rng);
      opponentCards = Array.isArray(opponentDeckState.cards) ? opponentDeckState.cards : [];
    }
    if (opponentCards.length === 0) {
      opponentCards = buildLibraryData(null, !opponentIsAI);
    }
    this.opponent.library.cards = [];
    for (const cardData of opponentCards) {
      validateCardData(cardData);
      this.opponent.library.add(new Card(cardData));
    }

    this.player.library.shuffle(rng);
    this.opponent.library.shuffle(rng);

    const startingKey = chooseStartingPlayerKey(this.rng);
    const startingPlayer = startingKey === 'player' ? this.player : this.opponent;
    const waitingPlayer = startingKey === 'player' ? this.opponent : this.player;
    if (this.state) {
      this.state.startingPlayer = startingKey;
    }

    this.turns.setActivePlayer(startingPlayer);
    // Draw opening hand
    this.draw(startingPlayer, 3);
    this.draw(waitingPlayer, 3);
    this.turns.startTurn();
    this.resources.startTurn(startingPlayer);

    if (startingPlayer === this.opponent
      && this._isAIControlled(this.opponent)
      && !this._isAIControlled(this.player)) {
      await this._executeOpponentTurn({ skipSetup: true, preserveTurn: true });
    }

    if (this.state?.difficulty === 'hybrid' || this.state?.difficulty === 'nightmare') {
      this._ensureNNModelLoading();
    }
  }

  async _loadAIDeckTemplates() {
    if (Array.isArray(this._aiDeckTemplates)) return this._aiDeckTemplates;

    const sanitizeDeckNames = (input) => {
      if (!Array.isArray(input)) return [];
      const seen = new Set();
      for (const value of input) {
        if (typeof value !== 'string') continue;
        let trimmed = value.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase().endsWith('.json')) trimmed = trimmed.slice(0, -5);
        if (!trimmed) continue;
        seen.add(trimmed);
      }
      return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    };

    let deckNames = [];
    let fsModule = null;
    if (typeof window === 'undefined') {
      try {
        fsModule = await import('fs/promises');
        try {
          const indexUrl = new URL('../../data/decks/index.json', import.meta.url);
          const rawIndex = JSON.parse(await fsModule.readFile(indexUrl, 'utf8'));
          deckNames = sanitizeDeckNames(rawIndex);
        } catch {}
        if (!deckNames.length) {
          try {
            const dirUrl = new URL('../../data/decks/', import.meta.url);
            const files = await fsModule.readdir(dirUrl);
            deckNames = sanitizeDeckNames(files);
          } catch {}
        }
      } catch {}
    } else {
      try {
        const indexRes = await fetch(new URL('../../data/decks/index.json', import.meta.url)).catch(() => null);
        if (indexRes && indexRes.ok) {
          try {
            const rawIndex = await indexRes.json();
            deckNames = sanitizeDeckNames(rawIndex);
          } catch {}
        }
      } catch {}
    }

    if (!deckNames.length) deckNames = ['deck1', 'deck2', 'deck3', 'deck4', 'deck5'];

    const entries = [];

    if (typeof window === 'undefined') {
      if (!fsModule) {
        try { fsModule = await import('fs/promises'); } catch {}
      }
      if (fsModule) {
        for (const name of deckNames) {
          try {
            const url = new URL(`../../data/decks/${name}.json`, import.meta.url);
            const txt = await fsModule.readFile(url, 'utf8');
            entries.push({ name, data: JSON.parse(txt) });
          } catch {}
        }
      }
    } else {
      const fetches = deckNames.map((name) => fetch(new URL(`../../data/decks/${name}.json`, import.meta.url)).catch(() => null));
      const results = await Promise.all(fetches);
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res && res.ok) {
          try {
            const data = await res.json();
            entries.push({ name: deckNames[i], data });
          } catch {}
        }
      }
    }

    const normalized = [];
    for (const entry of entries) {
      const raw = entry?.data;
      if (!raw) continue;
      let heroId = null;
      let cards = [];
      if (Array.isArray(raw)) {
        cards = raw;
      } else if (typeof raw === 'object') {
        if (typeof raw.hero === 'string') heroId = raw.hero;
        if (Array.isArray(raw.cards)) cards = raw.cards;
      }
      if (typeof heroId !== 'string' || !heroId) continue;
      const normalizedCards = [];
      for (const cardId of cards) {
        if (typeof cardId === 'string') {
          if (cardId) normalizedCards.push(cardId);
        } else if (cardId != null) {
          const asString = String(cardId);
          if (asString) normalizedCards.push(asString);
        }
      }
      if (normalizedCards.length === 0) continue;
      normalized.push({ heroId, cards: normalizedCards, name: entry.name });
    }

    this._aiDeckTemplates = normalized;
    return this._aiDeckTemplates;
  }

  async getPrebuiltDecks() {
    if (Array.isArray(this._playerDeckTemplates)) {
      return this._playerDeckTemplates.map((deck) => ({
        name: deck.name || null,
        hero: deck.hero || null,
        cards: Array.isArray(deck.cards) ? deck.cards.slice() : [],
      }));
    }

    let templates = [];
    try {
      templates = await this._loadAIDeckTemplates();
    } catch {
      templates = [];
    }
    if (!Array.isArray(templates) || templates.length === 0) {
      this._playerDeckTemplates = [];
      return [];
    }

    let cardById = this._cardIndex;
    if (!(cardById instanceof Map) || cardById.size === 0) {
      cardById = new Map(Array.isArray(this.allCards) ? this.allCards.map((card) => [card.id, card]) : []);
      this._cardIndex = cardById;
    }

    const decks = [];
    for (const template of templates) {
      const deck = buildDeckFromTemplate(template, cardById);
      if (!deck) continue;
      decks.push({
        name: deck.name || null,
        hero: deck.hero || null,
        cards: deck.cards.slice(),
      });
    }
    this._playerDeckTemplates = decks;
    return decks.map((deck) => ({
      name: deck.name || null,
      hero: deck.hero || null,
      cards: deck.cards.slice(),
    }));
  }

  draw(player, n = 1) {
    if (!this._isParticipant(player)) return 0;
    if (this.isGameOver()) return 0;
    const drawn = player.library.draw(n);
    for (const c of drawn) player.hand.add(c);
    return drawn.length;
  }

  async useHeroPower(player) {
    if (!this._isParticipant(player)) return false;
    if (this.isGameOver()) return false;
    const hero = player?.hero;
    if (!hero || hero.powerUsed) return false;
    if (hero.data?.freezeTurns > 0) return false;
    if (!hero.active?.length) return false;
    const cost = 2;
    if (!this.resources.pay(player, cost)) return false;
    await this.throttleAIAction(player);
    const finishTargetCapture = this._pushActionTargetScope();
    const loggedTargets = new Set();
    const heroPowerUsesSpellDamage = effectListDealsDamageToOthers(hero.active);
    const context = {
      game: this,
      player,
      card: hero,
      spellPowerApplies: heroPowerUsesSpellDamage,
      recordLogTarget: (target) => {
        if (!target) return;
        loggedTargets.add(target);
        try { this.recordActionTarget?.(target); } catch {}
      },
    };
    let logTargets = [];
    try {
      await this.effects.execute(hero.active, context);
      logTargets = finishTargetCapture();
    } catch (err) {
      finishTargetCapture({ discard: true });
      throw err;
    }
    hero.powerUsed = true;
    if (Array.isArray(player?.log)) {
      if ((!Array.isArray(logTargets) || logTargets.length === 0) && loggedTargets.size > 0) {
        logTargets = Array.from(loggedTargets);
      }
      const msg = this._formatLogWithTargets('Used hero power', logTargets, { preposition: 'on' });
      player.log.push(msg);
    }
    return true;
  }

  addCardToHand(cardId) {
    const cardData = this.allCards.find(c => c.id === cardId);
    if (cardData) {
      const newCard = new Card(cardData);
      this.player.hand.add(newCard);
      console.log(`Added ${newCard.name} to hand.`);
      if (this._uiRerender) {
        this._uiRerender();
      }
      return true;
    }
    console.warn(`Card with ID ${cardId} not found.`);
    return false;
  }

  start() {
    // RAF loop removed; gameplay is event-driven via DOM/UI actions
  }

  update(dt) {
    this.state.frame++;
  }

  canPlay(player, card) {
    return this.resources.canPay(player, card.cost || 0);
  }

  

  async playFromHand(player, cardRef) {
    if (!this._isParticipant(player)) return false;
    if (this.isGameOver()) return false;
    let card = null;
    if (cardRef && typeof cardRef === 'object') {
      card = player.hand.cards.find((c) => matchesCardIdentifier(c, cardRef)) || null;
    } else if (cardRef != null) {
      card = player.hand.cards.find((c) => matchesCardIdentifier(c, cardRef)) || null;
    }
    if (!card) return false;
    const cost = card.cost || 0;
    if (!this.resources.pay(player, cost)) return false;
    await this.throttleAIAction(player);
    // Check opponent secrets that may counter spells before any effects resolve
    const defender = (player === this.player) ? this.opponent : this.player;
    const oppSecrets = Array.isArray(defender?.hero?.data?.secrets) ? defender.hero.data.secrets : [];
    const counterIdx = (card.type === 'spell') ? oppSecrets.findIndex(s => s?.type === 'counterShot') : -1;
    if (counterIdx >= 0) {
      // Consume the counter secret and fizzle the spell
      const tok = oppSecrets.splice(counterIdx, 1)[0] || null;
      // Ensure the caster does not retain a phantom secret indicator for the countered card
      const casterSecrets = Array.isArray(player?.hero?.data?.secrets) ? player.hero.data.secrets : null;
      if (casterSecrets?.length && card?.instanceId != null) {
        const pendingIdx = casterSecrets.findIndex((t) => t?.cardInstanceId === card.instanceId);
        if (pendingIdx >= 0) casterSecrets.splice(pendingIdx, 1);
      }
      const searchZones = [
        defender.hand,
        defender.graveyard,
        defender.battlefield,
        defender.library,
        defender.removed,
      ];
      const secretCard = tok
        ? searchZones.map((zone) => {
          const cards = zone?.cards;
          if (!Array.isArray(cards)) return null;
          if (tok.cardInstanceId != null) {
            const byInstance = cards.find((c) => c?.instanceId === tok.cardInstanceId);
            if (byInstance) return byInstance;
          }
          if (tok.cardId != null) {
            return cards.find((c) => c?.id === tok.cardId) || null;
          }
          return null;
        }).find(Boolean) || null
        : null;
      logSecretTriggered(this, defender, { card: secretCard, token: tok });
      try { this.bus.emit('secret:removed', { player: defender, card: null }); } catch {}
      try { this._uiRerender?.(); } catch {}
      // Move spell straight to graveyard without resolving effects
      player.hand.moveTo(player.graveyard, card);
      this.bus.emit('cardPlayed', { player, card });
      player.log.push(`Played ${card.name} (countered)`);
      player.cardsPlayedThisTurn += 1;
      return true;
    }
    let tempSpellDamage = 0;
    const bonus = player.hero.data.nextSpellDamageBonus;
    let bonusSourceId = null;
    const finishTargetCapture = this._pushActionTargetScope();
    if (card.type === 'spell' && bonus && !bonus.used) {
      player.hero.data.spellDamage = (player.hero.data.spellDamage || 0) + bonus.amount;
      bonus.used = true;
      tempSpellDamage = bonus.amount;
      bonusSourceId = bonus.sourceCardId || null;
    }

    const comboActive = player.cardsPlayedThisTurn > 0;
    const loggedTargets = new Set();
    const context = {
      game: this,
      player,
      card,
      comboActive,
      recordLogTarget: (target) => {
        if (!target) return;
        loggedTargets.add(target);
        try { this.recordActionTarget?.(target); } catch {}
      },
    };

    let primaryEffects = card.effects;
    let comboEffects = comboActive && card.combo && card.combo.length > 0 ? card.combo : null;

    // For spells with combo effects that replace the base effect, only execute the combo effects
    if (comboActive && card.type === 'spell' && comboEffects) {
      primaryEffects = comboEffects;
      comboEffects = null;
    }

    if (card.type === 'ally' && card.keywords?.includes('Battlecry')) {
      const battlecryDealsDamage = effectListDealsDamageToOthers(primaryEffects)
        || effectListDealsDamageToOthers(comboEffects);
      if (battlecryDealsDamage) context.spellPowerApplies = true;
    }

    const isAlly = card.type === 'ally';
    const capturePresence = (data, key) => ({
      value: data[key],
      present: Object.prototype.hasOwnProperty.call(data, key),
    });
    let movedAllyBeforeEffects = false;
    let allyDataSnapshot = null;
    let originalHandIndex = -1;

    if (isAlly) {
      originalHandIndex = player.hand.cards.indexOf(card);
      player.hand.moveTo(player.battlefield, card);
      movedAllyBeforeEffects = true;
      const data = card.data || (card.data = {});
      allyDataSnapshot = {
        attacked: capturePresence(data, 'attacked'),
        summoningSick: capturePresence(data, 'summoningSick'),
        enteredTurn: capturePresence(data, 'enteredTurn'),
        divineShield: capturePresence(data, 'divineShield'),
      };
      data.enteredTurn = this.turns.turn;
      if (!(card.keywords?.includes('Rush') || card.keywords?.includes('Charge'))) {
        data.attacked = true;
        data.summoningSick = true;
      }
      if (card.keywords?.includes('Divine Shield')) {
        data.divineShield = true;
      }
    }

    const restoreAllyPlacement = () => {
      if (!movedAllyBeforeEffects) return;
      player.battlefield.remove(card);
      const handCards = player.hand.cards;
      const normalizeIndex = (idx, arr) => {
        if (typeof idx !== 'number' || Number.isNaN(idx)) return arr.length;
        if (idx < 0) return 0;
        if (idx > arr.length) return arr.length;
        return idx;
      };
      let desiredIndex = normalizeIndex(originalHandIndex, handCards);
      const currentIndex = handCards.indexOf(card);
      if (currentIndex === -1) {
        handCards.splice(desiredIndex, 0, card);
      } else if (currentIndex !== desiredIndex) {
        handCards.splice(currentIndex, 1);
        desiredIndex = normalizeIndex(originalHandIndex, handCards);
        handCards.splice(desiredIndex, 0, card);
      }
      const data = card.data || (card.data = {});
      const restore = (key, info) => {
        if (!info || !info.present) delete data[key];
        else data[key] = info.value;
      };
      restore('attacked', allyDataSnapshot?.attacked);
      restore('summoningSick', allyDataSnapshot?.summoningSick);
      restore('enteredTurn', allyDataSnapshot?.enteredTurn);
      restore('divineShield', allyDataSnapshot?.divineShield);
      movedAllyBeforeEffects = false;
    };

    try {
      if (primaryEffects && primaryEffects.length > 0) {
        const hasDeathrattle = card.keywords?.includes('Deathrattle');
        if (card.type === 'ally' && hasDeathrattle) {
          card.deathrattle = primaryEffects;
          card.effects = [];
        } else {
          await this.effects.execute(primaryEffects, context);
        }
      }

      if (comboEffects) {
        await this.effects.execute(comboEffects, context);
      }
    } catch (err) {
      if (err === this.CANCEL) {
        restoreAllyPlacement();
        // Refund cost and revert temporary spell damage bonus consumption
        if (typeof this.resources.refund === 'function') this.resources.refund(player, cost);
        else this.resources.restore(player, cost);
        if (tempSpellDamage) {
          player.hero.data.spellDamage -= tempSpellDamage;
          if (bonus) bonus.used = false;
        }
        finishTargetCapture({ discard: true });
        return false;
      }
      restoreAllyPlacement();
      finishTargetCapture({ discard: true });
      throw err;
    }

    if (tempSpellDamage) {
      if (bonusSourceId) {
        const eqList = Array.isArray(player.hero.equipment) ? player.hero.equipment : [];
        const eq = eqList.find(e => matchesCardIdentifier(e, bonusSourceId));
        const storedSourceId = player?.hero?.data?.nextSpellDamageBonus?.sourceCardId ?? null;
        const storedMatchesBonusSource = storedSourceId != null
          ? matchesCardIdentifier({ instanceId: storedSourceId, id: storedSourceId }, bonusSourceId)
          : false;
        if (eq && typeof eq.durability === 'number') {
          eq.durability -= 1;
          if (player?.log) player.log.push(`${eq.name} empowered a spell (-1 durability).`);
          if (eq.durability <= 0) {
            if (player?.log) player.log.push(`${eq.name} broke and was destroyed.`);
            let moved = false;
            if (player?.battlefield && player?.graveyard) {
              const res = player.battlefield.moveTo(player.graveyard, eq);
              moved = !!res;
            }
            if (!moved && player?.graveyard?.add) {
              player.graveyard.add(eq);
            }
            if (storedMatchesBonusSource) {
              delete player.hero.data.nextSpellDamageBonus;
            }
          }
          player.hero.equipment = eqList.filter(e => (e?.durability ?? 1) > 0);
        } else if (storedMatchesBonusSource) {
          delete player.hero.data.nextSpellDamageBonus;
        }
      }

      player.hero.data.spellDamage -= tempSpellDamage;
    }

    if (card.type === 'equipment') {
      player.hand.moveTo(player.battlefield, card);
      player.equip(card);
    } else if (card.type === 'ally') {
      if (!movedAllyBeforeEffects) {
        player.hand.moveTo(player.battlefield, card);
        const data = card.data || (card.data = {});
        data.enteredTurn = this.turns.turn;
        if (!(card.keywords?.includes('Rush') || card.keywords?.includes('Charge'))) {
          data.attacked = true;
          data.summoningSick = true;
        }
        if (card.keywords?.includes('Divine Shield')) {
          data.divineShield = true;
        }
      }
    } else if (card.type === 'quest') {
      player.hand.moveTo(player.battlefield, card);
      this.quests.addQuest(player, card);
    } else {
      player.hand.moveTo(player.graveyard, card);
    }

    this.bus.emit('cardPlayed', { player, card });
    let targetsForLog = finishTargetCapture();
    if ((!Array.isArray(targetsForLog) || targetsForLog.length === 0) && loggedTargets.size > 0) {
      targetsForLog = Array.from(loggedTargets);
    }
    let logMessage;
    if (this._shouldObscureSecretLog(player, card)) {
      logMessage = 'Played a secret';
    } else {
      logMessage = this._formatLogWithTargets(`Played ${card.name}`, targetsForLog);
    }
    player.log.push(logMessage);
    player.cardsPlayedThisTurn += 1;

    return true;
  }

  async promptTarget(candidates, { allowNoMore = false } = {}) {
    candidates = candidates?.filter(c => c.type !== 'quest');
    if (!candidates?.length) return null;

    const activePlayer = this.turns?.activePlayer || null;
    const aiControlsTurn = !!activePlayer && (
      this._isAIControlled(activePlayer)
      || (this.state?.aiThinking && activePlayer === this.player)
    );

    // If the AI is acting (either the opponent or during autoplay), favor enemy targets
    if (aiControlsTurn) {
      const enemy = activePlayer === this.player ? this.opponent : this.player;
      const enemyTargets = candidates.filter(
        c => c === enemy.hero || enemy.battlefield.cards.includes(c)
      );
      const pool = enemyTargets.length ? enemyTargets : candidates;
      const picked = this.rng.pick(pool);
      if (picked) this.recordActionTarget(picked);
      return picked;
    }

    if (typeof document === 'undefined') {
      const chosen = candidates[0] ?? null;
      if (chosen) this.recordActionTarget(chosen);
      return chosen;
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'target-prompt';

      const list = document.createElement('ul');

      // Order: enemy hero, enemy allies, player hero, player allies
      const enemy = this.opponent;
      const me = this.player;
      const inCands = new Set(candidates);

      const ordered = [];
      if (inCands.has(enemy.hero)) ordered.push(enemy.hero);
      for (const c of enemy.battlefield.cards) {
        if (inCands.has(c)) ordered.push(c);
      }
      if (inCands.has(me.hero)) ordered.push(me.hero);
      for (const c of me.battlefield.cards) {
        if (inCands.has(c)) ordered.push(c);
      }
      // Append any remaining candidates not covered above
      for (const c of candidates) {
        if (!ordered.includes(c)) ordered.push(c);
      }

      const finish = (value) => {
        if (value && value !== this.CANCEL) this.recordActionTarget(value);
        resolve(value);
      };

      ordered.forEach((t) => {
        const li = document.createElement('li');
        const isEnemy = (t === enemy.hero) || enemy.battlefield.cards.includes(t);
        li.textContent = isEnemy ? `${t.name} (AI)` : t.name;
        li.addEventListener('click', () => {
          document.body.removeChild(overlay);
          finish(t);
        });
        list.appendChild(li);
      });

      overlay.appendChild(list);

      if (allowNoMore) {
        const done = document.createElement('button');
        done.textContent = 'No more targets';
        done.addEventListener('click', () => {
          document.body.removeChild(overlay);
          finish(null);
        });
        overlay.appendChild(done);
      }

      // Always provide a cancel option to close without choosing
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        document.body.removeChild(overlay);
        finish(this.CANCEL);
      });
      overlay.appendChild(cancel);

      document.body.appendChild(overlay);
    });
  }

  async promptOption(options) {
    if (!options?.length) return 0;
    const activePlayer = this.turns?.activePlayer || null;
    const aiControlsTurn = !!activePlayer && (
      this._isAIControlled(activePlayer)
      || (this.state?.aiThinking && activePlayer === this.player)
    );

    if (aiControlsTurn) {
      if (options.length === 1) return 0;
      return this.rng.randomInt(0, options.length);
    }

    if (typeof document === 'undefined') {
      return 0;
    }
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'option-prompt';

      const list = document.createElement('ul');

      options.forEach((t, idx) => {
        const li = document.createElement('li');
        li.textContent = t;
        li.addEventListener('click', () => {
          document.body.removeChild(overlay);
          resolve(idx);
        });
        list.appendChild(li);
      });

      overlay.appendChild(list);

      // Add a cancel button to allow backing out of the choice
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(this.CANCEL);
      });
      overlay.appendChild(cancel);
      document.body.appendChild(overlay);
    });
  }

  async attack(player, cardRef, targetRef = null) {
    if (!this._isParticipant(player)) return false;
    if (this.isGameOver()) return false;
    const defender = player === this.player ? this.opponent : this.player;
    const candidatesForAttack = [player.hero, ...player.battlefield.cards];
    let card = null;
    if (cardRef && typeof cardRef === 'object') {
      card = candidatesForAttack.find((c) => matchesCardIdentifier(c, cardRef)) || null;
    } else if (cardRef != null) {
      card = candidatesForAttack.find((c) => matchesCardIdentifier(c, cardRef)) || null;
    }
    if (!card) return false;
    if ((card?.data?.freezeTurns || 0) > 0) return false;
    const atk = typeof card.totalAttack === 'function' ? card.totalAttack() : (card.data?.attack ?? 0);
    if (atk < 1) return false;
    // Block if summoning sick (no Rush)
    if (card?.data?.summoningSick) return false;
    // Rush restriction: if the attacker has Rush and just entered this turn, it cannot hit the hero
    const hasRush = !!card?.keywords?.includes?.('Rush');
    const justEntered = !!(card?.data?.enteredTurn && card.data.enteredTurn === this.turns.turn);
    const maxAttacks = card?.keywords?.includes?.('Windfury') ? 2 : 1;
    const used = card?.data?.attacksUsed || 0;
    if (used >= maxAttacks) return false;
    let target = null;
    const candidates = [
      defender.hero,
      ...defender.battlefield.cards.filter((c) => {
        if (!c) return false;
        if (c.type === 'equipment' || c.type === 'quest') return false;
        const data = c.data || {};
        const health = typeof data.health === 'number' ? data.health : c.health;
        if (data.dead || (typeof health === 'number' && health <= 0)) return false;
        return true;
      })
    ];
    const legal = selectTargets(candidates);
    // For Rush on the turn it was summoned: require an enemy ally target; if none, the attack is not legal
    const pool = (hasRush && justEntered)
      ? legal.filter(c => !matchesCardIdentifier(c, defender.hero))
      : legal;
    if (pool.length === 0) return false;
    if (pool.length === 1) {
      const only = pool[0];
      if (only !== defender.hero) target = only;
    } else if (pool.length > 1) {
      if (targetRef) {
        const chosen = pool.find((c) => matchesCardIdentifier(c, targetRef)) || null;
        if (chosen && chosen !== defender.hero) target = chosen;
      } else {
        const choice = await this.promptTarget(pool);
        if (choice === this.CANCEL) return false; // respect cancel
        // If the enemy hero was chosen, leave target null to attack hero directly
        if (choice && choice !== defender.hero) target = choice;
      }
    }
    const heroAllowed = pool.some((c) => c === defender.hero);
    if (!target && !heroAllowed) return false;
    const actualTarget = target || defender.hero;
    await this.throttleAIAction(player);
    this.combat.clear();
    if (!this.combat.declareAttacker(card, actualTarget)) return false;
    this.combat.setDefenderHero(defender.hero);
    if (target) this.combat.assignBlocker(getCardInstanceId(card), target);
    const events = this.combat.resolve();
    for (const ev of events) {
      const srcOwner = [player.hero, ...player.battlefield.cards].includes(ev.source) ? player : defender;
      this.bus.emit('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
    }
    // Allow UI to reflect HP changes before removals
    if (this._uiRerender) {
      try { this._uiRerender(); } catch {}
    }
    await this.cleanupDeaths(player, defender);
    await this.cleanupDeaths(defender, player);
    this.checkForGameOver();
    player.log.push(`Attacked ${actualTarget.name} with ${card.name}`);
    // Mark attack usage
    card.data.attacked = true;
    card.data.attacksUsed = (card.data.attacksUsed || 0) + 1;
    // Stealth is lost when a unit attacks
    if (card?.keywords?.includes?.('Stealth')) {
      card.keywords = card.keywords.filter(k => k !== 'Stealth');
    }
    return true;
  }

  async _runSimpleAITurn(actor, defender) {
    if (!actor || !defender) return;
    const affordable = actor.hand.cards
      .filter((c) => this.canPlay(actor, c))
      .sort((a, b) => (a.cost || 0) - (b.cost || 0));
    if (affordable[0]) {
      await this.playFromHand(actor, affordable[0]);
      if (this.isGameOver()) return;
    }

    const attackers = actor.battlefield.cards.filter((c) => {
      if (!(c.type === 'ally' || c.type === 'equipment')) return false;
      const atk = typeof c.totalAttack === 'function' ? c.totalAttack() : (c.data?.attack || 0);
      const maxAttacks = c?.keywords?.includes?.('Windfury') ? 2 : 1;
      const used = c?.data?.attacksUsed || 0;
      return atk > 0 && !c?.data?.summoningSick && used < maxAttacks;
    });
    for (const card of attackers) {
      if (this.isGameOver()) break;
      const hasRush = !!card?.keywords?.includes?.('Rush');
      const justEntered = !!(card?.data?.enteredTurn && card.data.enteredTurn === this.turns.turn);
      const defenders = [
        defender.hero,
        ...defender.battlefield.cards.filter((c) => c.type !== 'equipment' && c.type !== 'quest')
      ];
      const legal = selectTargets(defenders);
      if (hasRush && justEntered) {
        const nonHero = legal.filter((t) => !matchesCardIdentifier(t, defender.hero));
        if (nonHero.length === 0) continue;
      }
      let block = null;
      if (legal.length === 1) {
        const only = legal[0];
        if (!matchesCardIdentifier(only, defender.hero)) block = only;
      } else if (legal.length > 1) {
        const choices = legal.filter((t) => !matchesCardIdentifier(t, defender.hero));
        block = this.rng.pick(choices);
      }
      const target = block || defender.hero;
      await this.throttleAIAction(actor);
      if (this.isGameOver()) break;
      const declared = this.combat.declareAttacker(card, target);
      if (!declared) continue;
      if (card.data) {
        card.data.attacked = true;
        card.data.attacksUsed = (card.data.attacksUsed || 0) + 1;
      }
      if (card?.keywords?.includes?.('Stealth')) {
        card.keywords = card.keywords.filter((k) => k !== 'Stealth');
      }
      if (block) this.combat.assignBlocker(getCardInstanceId(card), block);
      actor.log.push(`Attacked ${target.name} with ${card.name}`);
    }

    this.combat.setDefenderHero(defender.hero);
    const events = this.combat.resolve();
    for (const ev of events) {
      const srcOwner = [actor.hero, ...actor.battlefield.cards].includes(ev.source) ? actor : defender;
      this.bus.emit('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
    }
    if (this._uiRerender) {
      try { this._uiRerender(); } catch {}
    }
    await this.cleanupDeaths(defender, actor);
    await this.cleanupDeaths(actor, defender);
    this.checkForGameOver();
  }

  async _takeTurnWithDifficultyAI(actor, defender, difficulty, options = {}) {
    if (!actor || !defender) return;
    const {
      skipStart = false,
      manageThinking = true,
      trackPending = false,
    } = options;

    if (difficulty === 'nightmare' || difficulty === 'hybrid') {
      try { this._ensureNNModelLoading(); } catch {}
    }

    let pendingSet = false;
    if (manageThinking) {
      if (this.state) {
        this.state.aiThinking = true;
        this.state.aiProgress = 0;
      }
      this.bus.emit('ai:thinking', { thinking: true });
    }

    try {
      if (difficulty === 'nightmare') {
        const { default: NeuralAI, loadModelFromDiskOrFetch } = await import('./systems/ai-nn.js');
        await loadModelFromDiskOrFetch();
        const ai = new NeuralAI({ game: this, resourceSystem: this.resources, combatSystem: this.combat });
        await ai.takeTurn(actor, defender, { skipStart });
      } else if (difficulty === 'medium' || difficulty === 'hard' || difficulty === 'hybrid') {
        if (trackPending && this.state) {
          this.state.aiPending = { type: 'mcts', stage: 'queued' };
          pendingSet = true;
        }
        const ai = await this._createMctsAI(difficulty);
        try {
          if (skipStart) await ai.takeTurn(actor, defender, { resume: true });
          else await ai.takeTurn(actor, defender);
        } finally {
          if (pendingSet && this.state) {
            this.state.aiPending = null;
          }
        }
      } else {
        await this._runSimpleAITurn(actor, defender);
      }
    } finally {
      if (manageThinking) {
        if (this.state) this.state.aiThinking = false;
        this.bus.emit('ai:thinking', { thinking: false });
      }
    }
  }

  async _executeOpponentTurn({ skipSetup = false, preserveTurn = false } = {}) {
    if (!skipSetup) {
      this.turns.setActivePlayer(this.opponent);
      this.turns.startTurn();
      this.resources.startTurn(this.opponent);
    }

    const diff = this.state?.difficulty || this._defaultDifficulty;
    await this._takeTurnWithDifficultyAI(this.opponent, this.player, diff, { trackPending: true });

    if (this.isGameOver()) return;

    await this._finalizeOpponentTurn({ preserveTurn });
    if (preserveTurn) this._pendingTurnIncrement = true;
  }

  async cleanupDeaths(player, killer) {
    const dead = player.battlefield.cards.filter(c => c.data?.dead);
    for (const c of dead) {
      // Move the exact instance that died, not the first with matching id
      player.battlefield.moveTo(player.graveyard, c);
      if (c.keywords?.includes('Deathrattle') && c.deathrattle?.length) {
        await this.effects.execute(c.deathrattle, { game: this, player, card: c });
      }
      if (killer) this.bus.emit('allyDefeated', { player: killer, card: c });
    }
  }

  async autoplayTurn() {
    if (this.state?.aiThinking) return false;
    if (this.turns?.activePlayer && this.turns.activePlayer !== this.player) return false;
    if (this.isGameOver()) return false;

    if (this.state) {
      this.state.aiThinking = true;
      this.state.aiProgress = 0;
    }
    this.bus.emit('ai:thinking', { thinking: true });

    let completed = false;
    try {
      const diff = this.state?.difficulty || this._defaultDifficulty;
      await this._takeTurnWithDifficultyAI(this.player, this.opponent, diff, {
        skipStart: true,
        manageThinking: false,
      });
      if (this.isGameOver()) {
        if (this.state) {
          this.state.aiThinking = false;
          this.state.aiProgress = 1;
        }
        this.bus.emit('ai:thinking', { thinking: false });
        completed = true;
        return true;
      }
      await this.endTurn();
      completed = true;
      return true;
    } finally {
      if (!completed) {
        this.bus.emit('ai:thinking', { thinking: false });
        if (this.state) this.state.aiThinking = false;
      }
    }
  }

  async endTurn() {
    // Tick down end-of-turn freeze for the player before handing control to AI
    {
      const p = this.player;
      const all = [p.hero, ...p.battlefield.cards];
      for (const c of all) {
        const ft = c?.data?.freezeTurns || 0;
        if (ft > 0) c.data.freezeTurns = ft - 1;
      }
    }

    if (this.isGameOver()) return;

    const prepared = await this._finalizePlayerTurn();
    if (!prepared) return;

    await this._executeOpponentTurn({ skipSetup: true });
  }

  async resumePendingAITurn() {
    const pending = this.state?.aiPending;
    if (!pending || pending.type !== 'mcts') return false;
    const diff = this.state?.difficulty || this._defaultDifficulty;
    if (!(diff === 'medium' || diff === 'hard' || diff === 'hybrid')) {
      if (this.state) {
        this.state.aiPending = null;
        this.state.aiThinking = false;
      }
      this.bus.emit('ai:thinking', { thinking: false });
      return false;
    }
    if (this.turns.activePlayer !== this.opponent) {
      if (this.state) {
        this.state.aiPending = null;
        this.state.aiThinking = false;
      }
      this.bus.emit('ai:thinking', { thinking: false });
      return false;
    }
    const resume = pending.stage && pending.stage !== 'queued';
    const ai = await this._createMctsAI(diff);
    try {
      await ai.takeTurn(this.opponent, this.player, { resume });
    } finally {
      if (this.state) {
        this.state.aiThinking = false;
        this.state.aiPending = null;
      }
      this.bus.emit('ai:thinking', { thinking: false });
    }
    if (this.isGameOver()) return true;
    await this._finalizeOpponentTurn();
    return true;
  }

  _ensureNNModelLoading() {
    if (!this._nnModelPromise) {
      this._nnModelPromise = (async () => {
        const { loadModelFromDiskOrFetch } = await import('./systems/ai-nn.js');
        try {
          return await loadModelFromDiskOrFetch();
        } catch (err) {
          this._nnModelPromise = null;
          throw err;
        }
      })();
    }
    return this._nnModelPromise;
  }

  preloadNeuralModel() {
    let promise;
    try {
      promise = this._ensureNNModelLoading();
    } catch {
      return Promise.resolve(null);
    }
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {});
    }
    return promise;
  }

  async _createMctsAI(diff) {
    if (typeof this.opts?.createMctsAI === 'function') {
      const custom = await this.opts.createMctsAI(diff, this);
      if (custom) return custom;
    }
    const { default: MCTS_AI } = await import('./systems/ai-mcts.js');
    const config = {
      resourceSystem: this.resources,
      combatSystem: this.combat,
      game: this,
    };
    if (diff === 'hard') Object.assign(config, { iterations: 10000, rolloutDepth: 20 });
    if (diff === 'hybrid') {
      const { NeuralPolicyValueModel } = await import('./systems/ai-nn.js');
      const model = await this._ensureNNModelLoading();
      Object.assign(config, {
        iterations: 10000,
        rolloutDepth: 20,
        policyValueModel: new NeuralPolicyValueModel({ model }),
      });
    }
    return new MCTS_AI(config);
  }

  async _finalizeOpponentTurn({ preserveTurn = false } = {}) {
    if (this.isGameOver()) return;
    while(this.turns.current !== 'End') {
      this.turns.nextPhase();
    }
    const skipAdvance = preserveTurn || this._skipNextTurnAdvance;
    if (this._skipNextTurnAdvance) this._skipNextTurnAdvance = false;
    if (skipAdvance) {
      const prev = this.turns.current;
      this.turns.bus.emit('phase:end', { phase: prev, turn: this.turns.turn });
      this.turns.setActivePlayer(this.player);
      this.turns.startTurn();
      this.resources.startTurn(this.player);
    } else {
      this.turns.nextPhase(); // End -> Start, turn increments for player
      this.turns.setActivePlayer(this.player);
      this.turns.startTurn();
      this.resources.startTurn(this.player);
    }
  }

  async _finalizePlayerTurn() {
    if (this.isGameOver()) return false;
    while (this.turns.current !== 'End') {
      this.turns.nextPhase();
    }
    if (this._pendingTurnIncrement) {
      const prevPhase = this.turns.current;
      const prevTurn = this.turns.turn;
      this.turns.bus.emit('phase:end', { phase: prevPhase, turn: prevTurn });
      this.turns.turn += 1;
      this._pendingTurnIncrement = false;
    } else {
      this.turns.nextPhase();
    }
    this._skipNextTurnAdvance = true;
    this.turns.setActivePlayer(this.opponent);
    this.turns.startTurn();
    this.resources.startTurn(this.opponent);
    return true;
  }

  async reset(playerDeck = null) {
    this.state.frame = 0;
    this.state.startedAt = 0;
    this.state.matchOver = false;
    this.state.winner = null;
    this.turns.turn = 1;
    this.turns.current = 'Start';
    this.turns.activePlayer = null;
    if (this.effects?.reset) {
      this.effects.reset();
    }
    if (this.quests?.reset) {
      this.quests.reset();
    }
    if (typeof this.combat?.clear === 'function') {
      this.combat.clear();
      this.combat.setDefenderHero(null);
    }
    this.resources = new ResourceSystem(this.turns);
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });
    this._pendingTurnIncrement = false;
    this._skipNextTurnAdvance = false;
    await this.setupMatch(playerDeck);
  }

  dispose() {
    this.running = false;
    this._raf = 0;
    if (this.rootEl) this.rootEl.textContent = 'Disposed.';
  }
}
