/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { renderDeckBuilder } from '../src/js/ui/deckbuilder.js';

describe('deckbuilder UI', () => {
  test('adds hero and up to 60 cards', () => {
    const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
    const ally = { id: 'a1', name: 'Ally', type: 'ally', text: '', cost: 1, data: { attack: 1, health: 1 } };
    const allCards = [hero, ally];
    const state = { hero: null, cards: [] };
    const container = document.createElement('div');
    const rerender = () => renderDeckBuilder(container, { state, allCards, onChange: rerender });
    rerender();
    const tips = container.querySelectorAll('.card-tooltip');
    expect(tips).toHaveLength(2);
    tips[0].dispatchEvent(new window.Event('click'));
    expect(state.hero).toBe(hero);
    for (let i = 0; i < 61; i++) {
      tips[1].dispatchEvent(new window.Event('click'));
    }
    expect(state.cards).toHaveLength(60);
    rerender();
    expect(container.textContent).toContain('Cards: 60/60');
  });

  test('only allows a single quest', () => {
    const hero = { id: 'h1', name: 'Hero', type: 'hero', text: '', data: { armor: 0 } };
    const quest1 = { id: 'q1', name: 'Quest1', type: 'quest', text: '' };
    const quest2 = { id: 'q2', name: 'Quest2', type: 'quest', text: '' };
    const allCards = [hero, quest1, quest2];
    const state = { hero: null, cards: [] };
    const container = document.createElement('div');
    const rerender = () => renderDeckBuilder(container, { state, allCards, onChange: rerender });
    rerender();
    const tips = container.querySelectorAll('.card-tooltip');
    // add first quest
    tips[1].dispatchEvent(new window.Event('click'));
    // attempt to add second quest
    tips[2].dispatchEvent(new window.Event('click'));
    expect(state.cards.filter(c => c.type === 'quest')).toHaveLength(1);
  });

  test('prefab dropdown lists decks and triggers selection callback', () => {
    const hero = { id: 'h1', name: 'Valeera', type: 'hero', text: '', data: { armor: 0 } };
    const ally = { id: 'a1', name: 'Ally', type: 'ally', text: '', cost: 1, data: { attack: 1, health: 1 } };
    const allCards = [hero, ally];
    const state = { hero: null, cards: [], selectedPrebuiltDeck: null };
    const prebuiltDecks = [{ name: 'starter', hero, cards: Array(60).fill(ally) }];
    const container = document.createElement('div');
    const onSelect = jest.fn();
    const rerender = () => renderDeckBuilder(container, { state, allCards, onChange: rerender, prebuiltDecks, onSelectPrebuilt: onSelect });
    rerender();
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map(opt => opt.value)).toContain('starter');
    expect(Array.from(select.options).map(opt => opt.textContent)).toContain('starter (Valeera)');
    select.value = 'starter';
    select.dispatchEvent(new window.Event('change'));
    expect(onSelect).toHaveBeenCalledWith('starter');
  });

  test('adding a card clears prefab selection state', () => {
    const hero = { id: 'h1', name: 'Valeera', type: 'hero', text: '', data: { armor: 0 } };
    const ally = { id: 'a1', name: 'Ally', type: 'ally', text: '', cost: 1, data: { attack: 1, health: 1 } };
    const allCards = [hero, ally];
    const state = { hero, cards: [], selectedPrebuiltDeck: 'starter' };
    const container = document.createElement('div');
    const rerender = () => renderDeckBuilder(container, { state, allCards, onChange: rerender, prebuiltDecks: [], onSelectPrebuilt: () => {} });
    rerender();
    const allyTip = container.querySelectorAll('.card-tooltip')[1];
    allyTip.dispatchEvent(new window.Event('click'));
    expect(state.selectedPrebuiltDeck).toBeNull();
  });
});
