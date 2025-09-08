/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderPlay } from '../src/js/ui/play.js';
import Hero from '../src/js/entities/hero.js';

describe('UI Play', () => {
  test('renders hero panes with name, health, and abilities', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 }, text: 'Player ability', keywords: ['Swift'] });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 }, text: 'Enemy ability', keywords: ['Stealth'] });

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
    expect(playerPane.textContent).toContain('Player ability');

    const enemyPane = container.querySelector('.row.enemy .hero-pane');
    expect(enemyPane.textContent).toContain('Enemy Hero');
    expect(enemyPane.textContent).toContain('Health: 20');
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
});

