/** @jest-environment jsdom */
import { renderDeckBuilder } from '../src/js/ui/deckbuilder.js';

describe('deckbuilder search', () => {
  test('filters by name and keywords (fuzzy)', () => {
    const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
    const demonAlly = { id: 'a1', name: 'Felguard', type: 'ally', text: '', cost: 3, data: { attack: 3, health: 3 }, keywords: ['Demon', 'Taunt'] };
    const beastAlly = { id: 'a2', name: 'Savannah Highmane', type: 'ally', text: '', cost: 6, data: { attack: 6, health: 5 }, keywords: ['Beast'] };
    const allCards = [hero, demonAlly, beastAlly];
    const state = { hero: null, cards: [], searchQuery: '' };
    const container = document.createElement('div');
    const rerender = () => renderDeckBuilder(container, { state, allCards, onChange: rerender });
    rerender();
    // Initially all 3 are visible in the pool
    expect(container.querySelectorAll('.card-tooltip:not([hidden])').length).toBe(3);

    // Type partial fuzzy query for demon keyword
    const input = container.querySelector('input[type="search"]');
    input.value = 'dem';
    input.dispatchEvent(new window.Event('input'));
    // Only the demon ally remains visible
    const visible1 = [...container.querySelectorAll('.card-tooltip:not([hidden])')];
    expect(visible1).toHaveLength(1);
    expect(visible1[0].textContent).toContain('Felguard');

    // Multiple tokens must all match (e.g., taunt demon)
    const input2 = container.querySelector('input[type="search"]');
    input2.value = 'taun dem';
    input2.dispatchEvent(new window.Event('input'));
    const visible2 = [...container.querySelectorAll('.card-tooltip:not([hidden])')];
    expect(visible2).toHaveLength(1);
    expect(visible2[0].textContent).toContain('Felguard');

    // Search by name fuzzy
    const input3 = container.querySelector('input[type="search"]');
    input3.value = 'sav high';
    input3.dispatchEvent(new window.Event('input'));
    const visible3 = [...container.querySelectorAll('.card-tooltip:not([hidden])')];
    expect(visible3).toHaveLength(1);
    expect(visible3[0].textContent).toContain('Savannah Highmane');
  });
});
