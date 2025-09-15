import fs from 'fs';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const cards = [
  ...read('hero'),
  ...read('spell'),
  ...read('ally'),
  ...read('equipment'),
  ...read('quest'),
  ...read('consumable'),
];

test('cards with Combo keyword define combo effects', () => {
const comboCards = cards.filter(c =>
  c.type === 'spell' && c.keywords && c.keywords.some(k => k.includes('Combo'))
);
  expect(comboCards.length).toBeGreaterThan(0);
  const anyImplementsCombo = comboCards.some(card => {
    const hasComboArray = Array.isArray(card.combo) && card.combo.length > 0;
    const hasComboAmount = Array.isArray(card.effects) && card.effects[0] && typeof card.effects[0].comboAmount === 'number';
    return hasComboArray || hasComboAmount;
  });
  expect(anyImplementsCombo).toBe(true);
});
