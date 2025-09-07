import { validateCardData, loadFromModule } from '../src/js/systems/content.js';
import { parse } from '../tools/cards-ingest.mjs';

describe('Content pipeline', () => {
  test('module loader validates card shape', () => {
    const mod = { default: [{ id: 'ally-a', type: 'ally', name: 'A', cost: 1 }] };
    const cards = loadFromModule(mod);
    expect(cards.length).toBe(1);
    expect(() => loadFromModule({ default: [{ id: 'x', type: 'bad', name: '' }] })).toThrow();
  });

  test('cards-ingest parses basic lines', () => {
    const md = `\n- Fireball (Spell) - Cost 4\n- Footman (Ally) - Cost 1\n- Type: Hero — Mage (Meta)`;
    const out = parse(md);
    expect(out[0]).toMatchObject({ name: 'Fireball', type: 'spell', cost: 4 });
    expect(out[1]).toMatchObject({ name: 'Footman', type: 'ally', cost: 1 });
    // Skips meta lines
    expect(out.length).toBe(2);
  });
});
