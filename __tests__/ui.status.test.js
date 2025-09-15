/** @jest-environment jsdom */
import { renderPlay } from '../src/js/ui/play.js';
import Hero from '../src/js/entities/hero.js';

describe('UI status indicators', () => {
  beforeAll(() => {
    // Mock Image to avoid actual network
    const OriginalImage = global.Image;
    Object.defineProperty(global, '__OriginalImage__', { value: OriginalImage, configurable: true });
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
  });

  afterAll(() => {
    if (global.__OriginalImage__) global.Image = global.__OriginalImage__;
  });

  test('adds and removes overlays for divine shield, frozen, windfury, and stealth', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player', data: { health: 30 } });
    const enemyHero = new Hero({ name: 'Enemy', data: { health: 30 } });

    const ally = {
      id: 'ally-test-minion',
      name: 'Test Ally',
      type: 'ally',
      cost: 2,
      text: 'Test text',
      keywords: ['Windfury', 'Stealth'],
      data: { attack: 2, health: 3, divineShield: true, freezeTurns: 1 },
    };

    const game = {
      player: { hero: playerHero, battlefield: { cards: [ally] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: () => {}, attack: () => {}, endTurn: () => {}, playFromHand: () => true,
    };

    renderPlay(container, game);
    let cardEl = container.querySelector('.p-field .card-tooltip');
    expect(cardEl).toBeTruthy();
    expect(cardEl.querySelector('.status-overlay.status-divine-shield')).toBeTruthy();
    expect(cardEl.querySelector('.status-overlay.status-frozen')).toBeTruthy();
    expect(cardEl.querySelector('.status-overlay.status-windfury')).toBeTruthy();
    expect(cardEl.classList.contains('status-stealthed')).toBe(true);

    // Remove statuses and re-render
    ally.data.divineShield = false;
    ally.data.freezeTurns = 0;
    ally.keywords = [];

    renderPlay(container, game);
    cardEl = container.querySelector('.p-field .card-tooltip');
    expect(cardEl.querySelector('.status-overlay.status-divine-shield')).toBeFalsy();
    expect(cardEl.querySelector('.status-overlay.status-frozen')).toBeFalsy();
    expect(cardEl.querySelector('.status-overlay.status-windfury')).toBeFalsy();
    expect(cardEl.classList.contains('status-stealthed')).toBe(false);
  });
});

