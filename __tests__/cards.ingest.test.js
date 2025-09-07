import { parse } from '../tools/cards-ingest.mjs';

it('parses hero cards as hero type', () => {
  const md = `
- Jaina Proudmoore, Archmage (Hero)
- Fireball (Ability) - Cost 4
`;
  const cards = parse(md);
  const hero = cards.find(c => c.name.includes('Jaina'));
  expect(hero).toBeDefined();
  expect(hero.type).toBe('hero');
});
