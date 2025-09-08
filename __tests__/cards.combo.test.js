import fs from 'fs';

const cards = JSON.parse(
  fs.readFileSync(new URL('../data/cards.json', import.meta.url))
);

test('cards with Combo keyword define combo effects', () => {
  const comboCards = cards.filter(c =>
    c.keywords && c.keywords.some(k => k.includes('Combo'))
  );
  expect(comboCards.length).toBeGreaterThan(0);
  comboCards.forEach(card => {
    expect(card.combo).toBeDefined();
  });
});

