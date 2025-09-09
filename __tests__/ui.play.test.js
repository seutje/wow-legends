/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderPlay } from '../src/js/ui/play.js';
import Hero from '../src/js/entities/hero.js';

describe('UI Play', () => {
  test('renders hero panes with name, health, armor, and abilities', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25, armor: 5 }, text: 'Player ability', keywords: ['Swift'] });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20, armor: 3 }, text: 'Enemy ability', keywords: ['Stealth'] });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), resolveCombat: jest.fn(), endTurn: jest.fn(), toggleAttacker: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const playerPane = container.querySelector('.row.player .hero-pane');
    expect(playerPane.textContent).toContain('Player Hero');
    expect(playerPane.textContent).toContain('Health: 25');
    expect(playerPane.textContent).toContain('Armor: 5');
    expect(playerPane.textContent).toContain('Player ability');

    const enemyPane = container.querySelector('.row.enemy .hero-pane');
    expect(enemyPane.textContent).toContain('Enemy Hero');
    expect(enemyPane.textContent).toContain('Health: 20');
    expect(enemyPane.textContent).toContain('Armor: 3');
    expect(enemyPane.textContent).toContain('Enemy ability');
  });

  test('shows card image tooltip when art is available', () => {
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) {
            img.setAttribute('src', v);
            img.onload?.();
          },
          get() { return img.getAttribute('src'); }
        });
        return img;
      }
    };

    const container = document.createElement('div');
    const card = { id: 'hero-jaina-proudmoore-archmage', name: 'Jaina', text: 'Archmage' };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card], size: () => 1 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), resolveCombat: jest.fn(), endTurn: jest.fn(), toggleAttacker: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 0, clientY: 0 }));

    const tooltipImg = container.querySelector('.card-tooltip img');
    expect(tooltipImg).toBeTruthy();
    expect(tooltipImg.getAttribute('src')).toBe(`src/assets/cards/${card.id}.png`);

    global.Image = OriginalImage;
  });

  test('falls back to text tooltip when art is missing', () => {
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) {
            img.setAttribute('src', v);
            img.onerror?.();
          },
          get() { return img.getAttribute('src'); }
        });
        return img;
      }
    };

    const container = document.createElement('div');
    const card = { id: 'hero-thrall-warchief-of-the-horde', name: 'Thrall', text: 'Warchief' };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card], size: () => 1 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), resolveCombat: jest.fn(), endTurn: jest.fn(), toggleAttacker: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 0, clientY: 0 }));

    const tooltip = container.querySelector('.card-tooltip');
    expect(tooltip.textContent).toBe(card.text);
    expect(tooltip.querySelector('img')).toBeNull();

    global.Image = OriginalImage;
  });

  test('card tooltip fits within the viewport', () => {
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) {
            img.setAttribute('src', v);
            img.onload?.();
          },
          get() { return img.getAttribute('src'); }
        });
        return img;
      }
    };

    const prevW = window.innerWidth;
    const prevH = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 300 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 200 });

    const container = document.createElement('div');
    const card = { id: 'hero-jaina-proudmoore-archmage', name: 'Jaina', text: 'Archmage' };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card], size: () => 1 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), resolveCombat: jest.fn(), endTurn: jest.fn(), toggleAttacker: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 290, clientY: 190 }));

    const tooltip = container.querySelector('.card-tooltip');
    const img = tooltip.querySelector('img');
    expect(tooltip.style.maxWidth).toBe(`${window.innerWidth - 20}px`);
    expect(tooltip.style.maxHeight).toBe(`${window.innerHeight - 20}px`);
    expect(img.style.maxWidth).toBe('100%');
    expect(img.style.maxHeight).toBe('100%');

    global.Image = OriginalImage;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: prevW });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: prevH });
  });

  test('includes hero in battlefield zone list', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), resolveCombat: jest.fn(), endTurn: jest.fn(), toggleAttacker: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const battlefieldList = container.querySelector('.row.player .zone-list');
    expect(battlefieldList.textContent).toContain('Player Hero');
  });
});

