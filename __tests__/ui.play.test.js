/** @jest-environment jsdom */
import { renderPlay } from '../src/js/ui/play.js';
import Hero from '../src/js/entities/hero.js';

describe('UI Play', () => {
  test('renders log panes with player and enemy actions', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25, armor: 5 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20, armor: 3 } });
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: ['Played Card'] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: ['Played Other'] },
      resources: { pool: () => 0, available: () => 0 },
      draw: () => {}, attack: () => {}, endTurn: () => {}, playFromHand: () => true,
    };
    renderPlay(container, game);
    const playerLog = container.querySelector('.player-log');
    const enemyLog = container.querySelector('.enemy-log');
    expect(playerLog.textContent).toContain('Played Card');
    expect(enemyLog.textContent).toContain('Played Other');
  });

  test('displays hand cards using card tooltip markup', () => {
    const container = document.createElement('div');
    const card = { id: 'ally-test', name: 'Test Ally', text: 'text', cost: 1, type: 'ally', data: { attack: 1, health: 1 } };
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20 } });
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [card], size: () => 1 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: () => {}, attack: () => {}, endTurn: () => {}, playFromHand: () => true,
    };
    renderPlay(container, game);
    const cardEl = container.querySelector(`[data-card-id="${card.id}"]`);
    expect(cardEl).not.toBeNull();
    expect(cardEl.classList.contains('card-tooltip')).toBe(true);
  });

  test('shows hero card in dedicated hero zone', () => {
    const container = document.createElement('div');
    const playerHero = new Hero({ name: 'Player Hero', data: { health: 25, armor: 1 } });
    const enemyHero = new Hero({ name: 'Enemy Hero', data: { health: 20, armor: 0 } });
    const game = {
      player: { hero: playerHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      opponent: { hero: enemyHero, battlefield: { cards: [] }, hand: { cards: [], size: () => 0 }, log: [] },
      resources: { pool: () => 0, available: () => 0 },
      draw: () => {}, attack: () => {}, endTurn: () => {}, playFromHand: () => true,
    };
    renderPlay(container, game);
    const heroZone = container.querySelector('.player-hero .card-tooltip');
    expect(heroZone).not.toBeNull();
    expect(heroZone.textContent).toContain('Player Hero');
  });
});
