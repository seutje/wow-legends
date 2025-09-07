import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Game from '../src/js/game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadCards() {
  const data = await readFile(join(__dirname, '../data/cards.json'), 'utf8');
  return JSON.parse(data);
}

test('setupMatch uses cards.json for libraries', async () => {
  const g = new Game();
  await g.setupMatch();
  const cards = await loadCards();
  const first = cards.find(c => c.type !== 'hero');
  expect(g.player.library.cards[0].id).toBe(first.id);
});
