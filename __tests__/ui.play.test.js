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
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
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

  test('shows card tooltip with art, name, and text when art is available', () => {
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
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 0, clientY: 0 }));

    const tooltip = container.querySelector('.card-tooltip');
    const tooltipImg = tooltip.querySelector('img');
    expect(tooltipImg).toBeTruthy();
    expect(tooltipImg.getAttribute('src')).toBe(`src/assets/art/${card.id}-art.png`);
    expect(tooltip.textContent).toContain(card.name);
    expect(tooltip.textContent).toContain(card.text);

    global.Image = OriginalImage;
  });

  test('summoned allies show summoning card in tooltip', () => {
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
    const summoner = { id: 'spell-summon-infernal', name: 'Summon Infernal', text: 'Summon a 6/6 Infernal.' };
    const summoned = { id: 'token-infernal', name: 'Infernal', summonedBy: summoner };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [summoned] }, hand: { cards: [], size: () => 0 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${summoned.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 0, clientY: 0 }));

    const tooltip = container.querySelector('.card-tooltip');
    const tooltipImg = tooltip.querySelector('img');
    expect(tooltipImg).toBeTruthy();
    expect(tooltipImg.getAttribute('src')).toBe(`src/assets/art/${summoner.id}-art.png`);
    expect(tooltip.textContent).toContain(summoner.name);
    expect(tooltip.textContent).toContain(summoner.text);

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
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 0, clientY: 0 }));

    const tooltip = container.querySelector('.card-tooltip');
    expect(tooltip.textContent).toContain(card.name);
    expect(tooltip.textContent).toContain(card.text);
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
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 290, clientY: 190 }));

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

  test('shows only one tooltip at a time when hovering multiple cards', () => {
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
    const card1 = { id: 'hero-jaina-proudmoore-archmage', name: 'Jaina', text: 'Archmage' };
    const card2 = { id: 'hero-thrall-warchief-of-the-horde', name: 'Thrall', text: 'Warchief' };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });

    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card1, card2], size: () => 2 } },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 } },
      resources: { pool: () => 0, available: () => 0 },
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li1 = container.querySelector(`[data-card-id="${card1.id}"]`);
    li1.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 0, clientY: 0 }));
    const li2 = container.querySelector(`[data-card-id="${card2.id}"]`);
    li2.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 0, clientY: 0 }));

    const tooltips = container.querySelectorAll('.card-tooltip');
    expect(tooltips).toHaveLength(1);
    const tooltip = tooltips[0];
    const tooltipImg = tooltip.querySelector('img');
    expect(tooltipImg.getAttribute('src')).toBe(`src/assets/art/${card2.id}-art.png`);
    expect(tooltip.textContent).toContain(card2.name);

    global.Image = OriginalImage;
  });

  test('does not error if tooltip is removed before image loads', () => {
    jest.useFakeTimers();
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        const img = document.createElement('img');
        Object.defineProperty(img, 'src', {
          set(v) {
            img.setAttribute('src', v);
            setTimeout(() => img.onload?.(), 0);
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
      draw: jest.fn(), attack: jest.fn(), endTurn: jest.fn(), playFromHand: () => true,
    };

    renderPlay(container, game);

    const li = container.querySelector(`[data-card-id="${card.id}"]`);
    li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 0, clientY: 0 }));
    li.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(() => { jest.runAllTimers(); }).not.toThrow();
    expect(container.querySelector('.card-tooltip')).toBeNull();

    global.Image = OriginalImage;
    jest.useRealTimers();
  });

  test('includes hero in battlefield zone list', () => {
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

    const battlefieldList = container.querySelector('.row.player .zone-list');
    expect(battlefieldList.textContent).toContain('Player Hero');
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

