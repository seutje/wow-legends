/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderStartScreen, RANDOM_HERO_ID } from '../src/js/ui/startScreen.js';

describe('Start Screen Random Hero option', () => {
  let container;

  const decks = [
    {
      hero: { id: 'hero-001', name: 'Brave Hero', type: 'hero', text: 'Lead the charge.' },
      cards: Array.from({ length: 60 }, (_, i) => `card-${i}`),
    },
    {
      hero: { id: 'hero-002', name: 'Mystic Hero', type: 'hero', text: 'Harness arcane might.' },
      cards: Array.from({ length: 60 }, (_, i) => `card-b-${i}`),
    },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    container = null;
  });

  test('renders random hero card before other heroes with question mark art', () => {
    renderStartScreen(container, {
      visible: true,
      step: 'hero',
      decks,
    });

    const heroButtons = Array.from(container.querySelectorAll('.start-screen__hero'));
    expect(heroButtons.length).toBe(3);

    const randomButton = heroButtons[0];
    expect(randomButton.getAttribute('aria-label')).toBe('Random Hero');

    const titleEl = randomButton.querySelector('.card-info h4');
    expect(titleEl.textContent).toBe('Random Hero');

    const randomArt = randomButton.querySelector('.card-art--random');
    expect(randomArt).toBeTruthy();
    expect(randomArt.textContent.trim()).toBe('?');
  });

  test('invokes selection handler with random hero identifier', () => {
    const onSelectHero = jest.fn();
    renderStartScreen(container, {
      visible: true,
      step: 'hero',
      decks,
      onSelectHero,
    });

    const randomButton = container.querySelector('.start-screen__hero');
    randomButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelectHero).toHaveBeenCalledTimes(1);
    const selectedHero = onSelectHero.mock.calls[0][0];
    expect(selectedHero).toEqual(expect.objectContaining({ id: RANDOM_HERO_ID }));
    expect(selectedHero.name).toBe('Random Hero');
  });

  test('marks random opponent as selected via context', () => {
    renderStartScreen(container, {
      visible: true,
      step: 'opponent',
      decks,
      opponentContext: {
        playerHeroName: 'Test Hero',
        selectedOpponentId: RANDOM_HERO_ID,
      },
    });

    const randomButton = container.querySelector('.start-screen__hero');
    expect(randomButton.dataset.selected).toBe('1');
    expect(randomButton.getAttribute('aria-pressed')).toBe('true');
  });
});
