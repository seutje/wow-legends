import { validateCardData, loadFromModule } from '../src/js/systems/content.js';
import { parse } from '../tools/cards-ingest.mjs';

describe('Content pipeline', () => {
  test('module loader validates card shape', () => {
    const mod = { default: [{ id: 'ally-a', type: 'ally', name: 'A', cost: 1 }] };
    const cards = loadFromModule(mod);
    expect(cards.length).toBe(1);
    expect(() => loadFromModule({ default: [{ id: 'x', type: 'bad', name: '' }] })).toThrow();
  });
});
