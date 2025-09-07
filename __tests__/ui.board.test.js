/** @jest-environment jsdom */
import { renderBoard, wireInteractions } from '../src/js/ui/board.js';
import Player from '../src/js/entities/player.js';
import Card from '../src/js/entities/card.js';

describe('UI Board', () => {
  test('clicking library draws to hand; clicking hand moves to resources', () => {
    const container = document.createElement('div');
    const p = new Player({ name: 'U' });
    const c = new Card({ type: 'ally', name: 'A' });
    p.library.add(c);
    renderBoard(container, p);
    wireInteractions(container, p, { onChange: () => renderBoard(container, p) });
    // Click library item
    const libItem = container.querySelector('ul[data-zone="library"] li');
    libItem.click();
    expect(p.hand.size()).toBe(1);
    // Click hand item moves to resources
    const handItem = container.querySelector('ul[data-zone="hand"] li');
    handItem.click();
    expect(p.resourcesZone.size()).toBe(1);
  });
});

