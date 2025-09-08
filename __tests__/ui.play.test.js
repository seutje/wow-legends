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
});

