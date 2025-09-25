/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderPlay } from '../src/js/ui/play.js';
import Hero from '../src/js/entities/hero.js';
import { loadSettings, saveDifficulty } from '../src/js/utils/settings.js';

describe('UI Play', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('renders log panes with player and enemy actions', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25, armor: 5 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20, armor: 3 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: ['Played Card', 'Attacked Enemy'] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: ['Played Other'] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const playerLog = container.querySelector('.p-log.log-pane');
    expect(playerLog.textContent).toContain('Played Card');
    const enemyLog = container.querySelector('.ai-log.log-pane');
    expect(enemyLog.textContent).toContain('Played Other');
  });

  test('displays mana values within hero slots', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 30 } });

    const player = { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] };
    const opponent = { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] };
    const resources = {
      pool: jest.fn((owner) => (owner === player ? 5 : 7)),
      available: jest.fn((owner) => (owner === player ? 3 : 4))
    };

    const game = {
      player,
      opponent,
      resources,
      draw: jest.fn(),
      attack: jest.fn(),
      endTurn: jest.fn(),
      playFromHand: () => true
    };

    renderPlay(container, game);

    const enemyMana = container.querySelector('.ai-hero .hero-mana');
    expect(enemyMana.textContent).toBe('7/4 Mana');
    const playerMana = container.querySelector('.p-hero .hero-mana');
    expect(playerMana.textContent).toBe('5/3 Mana');

    resources.pool.mockImplementation((owner) => (owner === player ? 6 : 8));
    resources.available.mockImplementation((owner) => (owner === player ? 4 : 5));

    renderPlay(container, game);

    expect(container.querySelector('.ai-hero .hero-mana').textContent).toBe('8/5 Mana');
    expect(container.querySelector('.p-hero .hero-mana').textContent).toBe('6/4 Mana');
  });

  test('new game button appears before deck builder and calls handler', async () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25, armor: 5 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20, armor: 3 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
      state: {},
    };

    const onNewGame = jest.fn().mockResolvedValue();
    renderPlay(container, game, { onUpdate: jest.fn(), onNewGame });
    const controls = document.querySelector('header .controls');
    const buttons = Array.from(controls.querySelectorAll('button'));
    expect(buttons[0].textContent).toContain('New Game');
    expect(buttons[1].textContent).toContain('Deck Builder');
    const difficultySelect = controls.querySelector('select.select-difficulty');
    expect(difficultySelect.value).toBe('nightmare');

    buttons[0].dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(onNewGame).toHaveBeenCalled();
  });

  test('deck builder button toggles label and triggers handler', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 30, armor: 0 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 30, armor: 0 } });
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), autoplayTurn: jest.fn(),
      useHeroPower: jest.fn(), playFromHand: () => true,
      state: {},
    };

    const onToggleDeckBuilder = jest.fn();
    const onUpdate = jest.fn();

    renderPlay(container, game, { onUpdate, onToggleDeckBuilder, deckBuilderOpen: false });
    const controls = document.querySelector('header .controls');
    const deckBtn = controls.querySelector('.btn-deck-builder');
    expect(deckBtn.textContent).toBe('Deck Builder');
    expect(deckBtn.getAttribute('aria-pressed')).toBe('false');

    renderPlay(container, game, { onUpdate, onToggleDeckBuilder, deckBuilderOpen: true });
    expect(deckBtn.textContent).toBe('Back to game');
    expect(deckBtn.getAttribute('aria-pressed')).toBe('true');

    deckBtn.dispatchEvent(new Event('click'));
    expect(onToggleDeckBuilder).toHaveBeenCalledTimes(1);
  });

  test('log pane has zone styling and auto-scrolls to bottom', async () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25, armor: 5 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20, armor: 3 } });

    const entries = Array.from({ length: 20 }, (_, i) => `Entry ${i}`);
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: entries },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);
    await new Promise(r => setTimeout(r, 0));

    const pane = container.querySelector('.p-log.log-pane');
    const list = pane.querySelector('ul');
    expect(pane.classList.contains('zone')).toBe(true);
    expect(list.scrollTop + list.clientHeight).toBe(list.scrollHeight);
  });
  test('player hand renders visible cards with art and stats', () => {
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) { img.setAttribute('src', v); img.onload?.(); },
          get() { return img.getAttribute('src'); }
        });
        return img;
      }
    };

    const container = document.createElement('div');
    const card = {
      id: 'ally-scarlet-sorcerer',
      name: 'Scarlet Sorcerer',
      text: 'Spell Damage +1.',
      cost: 3,
      type: 'ally',
      keywords: ['Mage', 'Fire'],
      data: { attack: 3, health: 3 }
    };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card], size: () => 1 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);
    const tip = container.querySelector('.p-hand .card-tooltip');
    expect(tip).toBeTruthy();
    const img = tip.querySelector('.card-art');
    expect(img.getAttribute('src')).toBe(`src/assets/optim/${card.id}-art.png`);
    expect(tip.textContent).toContain(card.name);
    expect(tip.textContent).toContain(card.text);
    expect(tip.querySelector('.stat.cost').textContent).toBe(String(card.cost));
    expect(tip.querySelector('.stat.attack').textContent).toBe(String(card.data.attack));
    expect(tip.querySelector('.stat.health').textContent).toBe(String(card.data.health));
    expect(tip.querySelector('.card-type').textContent).toBe(card.type);
    expect(tip.querySelector('.card-keywords').textContent).toBe(card.keywords.join(', '));

    global.Image = OriginalImage;
  });

  test('summoned allies show summoning card art but actual stats', () => {
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) { img.setAttribute('src', v); img.onload?.(); },
          get() { return img.getAttribute('src'); }
        });
        return img;
      }
    };

    const container = document.createElement('div');
    const summoner = { id: 'spell-summon-infernal', name: 'Summon Infernal', text: 'Summon a 6/6 Infernal.', type: 'spell' };
    const summoned = { id: 'token-infernal', name: 'Infernal', type: 'ally', data: { attack: 6, health: 6 }, summonedBy: summoner };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [summoned] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);
    const tip = container.querySelector('.p-field .card-tooltip');
    const img = tip.querySelector('.card-art');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(`src/assets/optim/${summoner.id}-art.png`);
    // Name should reflect the summoned unit, not the summoner
    expect(tip.textContent).toContain(summoned.name);
    // Text still reflects the summoning effect description
    expect(tip.textContent).toContain(summoner.text);
    expect(tip.querySelector('.stat.attack').textContent).toBe('6');
    expect(tip.querySelector('.stat.health').textContent).toBe('6');

    global.Image = OriginalImage;
  });

  test('falls back to text when art is missing for visible cards', () => {
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) { img.setAttribute('src', v); img.onerror?.(); },
          get() { return img.getAttribute('src'); }
        });
        return img;
      }
    };

    const container = document.createElement('div');
    const card = { id: 'hero-thrall-warchief-of-the-horde', name: 'Thrall', text: 'Warchief', type: 'hero' };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card], size: () => 1 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);
    const tip = container.querySelector('.p-hand .card-tooltip');
    expect(tip.textContent).toContain(card.name);
    expect(tip.textContent).toContain(card.text);
    expect(tip.querySelector('.card-art')).toBeNull();

    global.Image = OriginalImage;
  });

  test('has a separate hero slot (not in battlefield list)', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const heroEl = container.querySelector('.p-hero .card-tooltip');
    expect(heroEl.textContent).toContain('Player Hero');
  });

  test('shows win dialog and restarts game', async () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 10 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 0 } });
    const reset = jest.fn().mockResolvedValue();
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true, reset,
    };
    renderPlay(container, game, { onUpdate: jest.fn() });
    const dialog = container.querySelector('.game-over');
    expect(dialog.textContent).toContain('You win!');
    const btn = dialog.querySelector('button');
    btn.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(reset).toHaveBeenCalled();
  });

  test('restart prefers saved deck when available', async () => {
    // Prepare saved deck in storage
    const heroId = 'hero-1';
    const cardIds = Array.from({ length: 60 }, (_, i) => `card-${i+1}`);
    const payload = { settings: { lastDeck: { heroId, cardIds } } };
    localStorage.setItem('wow-legends:settings', JSON.stringify(payload));

    const container = document.createElement('div');
    const playerHero = new Hero({ id: 'player-hero', name: 'Player', type: 'hero', data: { health: 10 } });
    const enemyHero = new Hero({ id: 'enemy-hero', name: 'Enemy', type: 'hero', data: { health: 0 } });
    const reset = jest.fn().mockResolvedValue();
    // allCards must include the saved hero and all 60 cards
    const allCards = [
      { id: heroId, name: 'Saved Hero', type: 'hero', data: { health: 30, armor: 0 } },
      ...cardIds.map(id => ({ id, name: id, type: 'ally', cost: 1 }))
    ];
    const game = {
      allCards,
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true, reset,
    };
    renderPlay(container, game, { onUpdate: jest.fn() });
    const dialog = container.querySelector('.game-over');
    const btn = dialog.querySelector('button');
    btn.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(reset).toHaveBeenCalledTimes(1);
    const arg = reset.mock.calls[0][0];
    expect(arg).toBeTruthy();
    expect(arg.hero.id).toBe(heroId);
    expect(arg.cards).toHaveLength(60);
  });

  test('restart falls back to random when no saved deck', async () => {
    // Ensure settings are cleared
    localStorage.removeItem('wow-legends:settings');

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 10 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 0 } });
    const reset = jest.fn().mockResolvedValue();
    const game = {
      allCards: [],
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true, reset,
    };
    renderPlay(container, game, { onUpdate: jest.fn() });
    const dialog = container.querySelector('.game-over');
    const btn = dialog.querySelector('button');
    btn.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(reset).toHaveBeenCalledTimes(1);
    // Expect null/undefined argument to signal random deck
    expect(reset.mock.calls[0][0] == null).toBe(true);
  });

  test('changing difficulty to hybrid preloads neural model and persists setting', () => {
    localStorage.removeItem('wow-legends:settings');
    saveDifficulty('easy');

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 10 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 10 } });
    const preload = jest.fn(() => ({ catch: () => {} }));
    const game = {
      state: { difficulty: 'easy' },
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
      preloadNeuralModel: preload,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const select = document.querySelector('header select.select-difficulty');
    expect(select).toBeTruthy();
    const options = Array.from(select.options).map(opt => opt.value);
    expect(options).toContain('hybrid');

    select.value = 'hybrid';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(game.state.difficulty).toBe('hybrid');
    expect(preload).toHaveBeenCalledTimes(1);
    const settings = loadSettings();
    expect(settings.difficulty).toBe('hybrid');

    saveDifficulty('easy');
    localStorage.removeItem('wow-legends:settings');
  });

  test('single tap previews a friendly ally and second tap attacks', async () => {
    if (typeof PointerEvent === 'undefined') {
      global.PointerEvent = class extends Event {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerType = params.pointerType || '';
        }
      };
    }

    let nowValue = 0;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => nowValue);

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });
    const ally = {
      id: 'ally-touch-test',
      instanceId: 'ally-touch-test#1',
      name: 'Touch Tester',
      text: 'Preview me!',
      type: 'ally',
      data: { attack: 2, health: 3 }
    };
    const attack = jest.fn().mockResolvedValue();
    const game = {
      player: { hero: playerHero, battlefield: { cards: [ally] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack, endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const cardEl = container.querySelector('.p-field .card-tooltip');
    expect(cardEl).toBeTruthy();

    const firstTap = new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true });
    cardEl.dispatchEvent(firstTap);

    expect(cardEl.dataset.touchPreview).toBe('1');
    expect(cardEl.style.getPropertyValue('--touch-translate-x')).toMatch(/px$/);
    expect(cardEl.style.getPropertyValue('--touch-translate-y')).toMatch(/px$/);

    nowValue = 1000;
    const secondTap = new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true });
    cardEl.dispatchEvent(secondTap);
    await Promise.resolve();

    expect(cardEl.dataset.touchPreview).toBeUndefined();
    expect(cardEl.style.getPropertyValue('--touch-translate-x')).toBe('');
    expect(cardEl.style.getPropertyValue('--touch-translate-y')).toBe('');
    expect(attack).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  test('tapping outside the previewed ally clears the enlargement without attacking', () => {
    if (typeof PointerEvent === 'undefined') {
      global.PointerEvent = class extends Event {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerType = params.pointerType || '';
        }
      };
    }

    let nowValue = 0;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => nowValue);

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });
    const ally = {
      id: 'ally-attack-test',
      instanceId: 'ally-attack-test#1',
      name: 'Double Tapper',
      text: 'Attack when double tapped',
      type: 'ally',
      data: { attack: 3, health: 3 }
    };
    const attack = jest.fn().mockResolvedValue();
    const game = {
      player: { hero: playerHero, battlefield: { cards: [ally] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack, endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const cardEl = container.querySelector('.p-field .card-tooltip');
    expect(cardEl).toBeTruthy();
    const boardEl = container.querySelector('.board');
    expect(boardEl).toBeTruthy();

    const firstTap = new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true });
    cardEl.dispatchEvent(firstTap);
    expect(cardEl.dataset.touchPreview).toBe('1');

    nowValue = 750;
    const outsideTap = new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true });
    document.dispatchEvent(outsideTap);

    expect(cardEl.dataset.touchPreview).toBeUndefined();
    expect(attack).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  test('tapping an enemy ally previews it without triggering attacks', async () => {
    if (typeof PointerEvent === 'undefined') {
      global.PointerEvent = class extends Event {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerType = params.pointerType || '';
        }
      };
    }

    let nowValue = 0;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => nowValue);

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });
    const enemyAlly = {
      id: 'enemy-touch-test',
      instanceId: 'enemy-touch-test#1',
      name: 'Enemy Touch Tester',
      text: 'Tap to preview!',
      type: 'ally',
      data: { attack: 4, health: 5 }
    };
    const attack = jest.fn().mockResolvedValue();
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [enemyAlly] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack, endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const enemyCardEl = container.querySelector('.ai-field .card-tooltip');
    expect(enemyCardEl).toBeTruthy();

    enemyCardEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
    expect(enemyCardEl.dataset.touchPreview).toBe('1');

    nowValue = 800;
    enemyCardEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(enemyCardEl.dataset.touchPreview).toBeUndefined();
    expect(attack).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  test('heroes support touch previews and clicks still trigger attacks', async () => {
    if (typeof PointerEvent === 'undefined') {
      global.PointerEvent = class extends Event {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerType = params.pointerType || '';
        }
      };
    }

    let nowValue = 0;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => nowValue);

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });
    const attack = jest.fn().mockResolvedValue();
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack, endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const enemyHeroEl = container.querySelector('.ai-hero .card-tooltip');
    const playerHeroEl = container.querySelector('.p-hero .card-tooltip');
    expect(enemyHeroEl).toBeTruthy();
    expect(playerHeroEl).toBeTruthy();

    enemyHeroEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
    expect(enemyHeroEl.dataset.touchPreview).toBe('1');
    nowValue = 600;
    enemyHeroEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
    expect(enemyHeroEl.dataset.touchPreview).toBeUndefined();
    expect(attack).not.toHaveBeenCalled();

    playerHeroEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
    expect(playerHeroEl.dataset.touchPreview).toBe('1');
    nowValue = 1000;
    playerHeroEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(playerHeroEl.dataset.touchPreview).toBeUndefined();
    expect(attack).not.toHaveBeenCalled();

    playerHeroEl.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(attack).toHaveBeenCalledWith(game.player, game.player.hero);

    nowSpy.mockRestore();
  });

  test('single tap previews a hand card and second tap plays it', async () => {
    if (typeof PointerEvent === 'undefined') {
      global.PointerEvent = class extends Event {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerType = params.pointerType || '';
        }
      };
    }

    let nowValue = 0;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => nowValue);

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });
    const handCard = {
      id: 'hand-touch-test',
      name: 'Tap to Play',
      text: 'Tap again to play.',
      type: 'spell',
      cost: 2,
      data: {}
    };
    const playFromHand = jest.fn().mockResolvedValue(true);
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [handCard], size: () => 1 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const cardEl = container.querySelector('.p-hand .card-tooltip');
    expect(cardEl).toBeTruthy();

    const firstTap = new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true });
    cardEl.dispatchEvent(firstTap);
    expect(cardEl.dataset.touchPreview).toBe('1');

    nowValue = 200;
    const secondTap = new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true });
    cardEl.dispatchEvent(secondTap);
    await Promise.resolve();

    expect(playFromHand).toHaveBeenCalledTimes(1);
    expect(playFromHand.mock.calls[0][1]).toBe(handCard);
    expect(cardEl.dataset.touchPreview).toBeUndefined();

    nowSpy.mockRestore();
  });

  test('tapping outside the previewed hand card clears it without playing the card', () => {
    if (typeof PointerEvent === 'undefined') {
      global.PointerEvent = class extends Event {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerType = params.pointerType || '';
        }
      };
    }

    let nowValue = 0;
    const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => nowValue);

    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });
    const handCard = {
      id: 'hand-touch-test-dismiss',
      name: 'Tap to Preview',
      text: 'Tap outside to close.',
      type: 'spell',
      cost: 3,
      data: {}
    };
    const playFromHand = jest.fn().mockResolvedValue(true);
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [handCard], size: () => 1 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand,
    };

    renderPlay(container, game, { onUpdate: jest.fn() });

    const cardEl = container.querySelector('.p-hand .card-tooltip');
    expect(cardEl).toBeTruthy();

    const firstTap = new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true });
    cardEl.dispatchEvent(firstTap);
    expect(cardEl.dataset.touchPreview).toBe('1');

    nowValue = 650;
    const outsideTap = new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true });
    document.dispatchEvent(outsideTap);

    expect(cardEl.dataset.touchPreview).toBeUndefined();
    expect(playFromHand).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  test('shows lose dialog when player hero health is zero', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 0 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 5 } });
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true, reset: jest.fn(),
    };
    renderPlay(container, game);
    const dialog = container.querySelector('.game-over');
    expect(dialog.textContent).toContain('You lose!');
  });
});
