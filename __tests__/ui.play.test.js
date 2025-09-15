/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderPlay } from '../src/js/ui/play.js';
import Hero from '../src/js/entities/hero.js';

describe('UI Play', () => {
  test('renders log panes with player and enemy actions', () => {
    const container = document.createElement('div');
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
