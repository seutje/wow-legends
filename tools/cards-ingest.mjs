#!/usr/bin/env node
// Parse CARDS.md sections → JSON (best-effort)
import fs from 'fs';
import path from 'path';

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parse(md) {
  const out = [];
  const sections = md.split(/^## /m);

  // Skip the first section (before the first ##)
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const sectionLines = section.split(/\r?\n/);
    const title = sectionLines[0];

    if (!title.includes('Cards')) continue;

    const cardBlocks = section.split(/^\d+\)\s/m);
    for (let j = 1; j < cardBlocks.length; j++) {
      const block = cardBlocks[j];
      if (block.trim().length === 0) continue;
      const blockLines = block.split(/\r?\n/);
      const name = blockLines[0].split('(')[0].trim();
      if (!name) continue;

      const card = {
        id: '',
        name: name,
        type: '',
        cost: undefined,
        text: '',
        keywords: [],
        stats: undefined
      };

      for (const line of blockLines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        const keyLc = key.toLowerCase().trim();

        if (keyLc.includes('type')) {
          card.type = value.split('—')[0].trim().toLowerCase();
        } else if (keyLc.includes('cost')) {
          const costMatch = value.match(/(\d+)/);
          if (costMatch) card.cost = Number(costMatch[1]);
        } else if (keyLc.includes('text')) {
          card.text = value;
        } else if (keyLc.includes('keywords')) {
          card.keywords = value.split(',').map(k => k.trim()).filter(Boolean);
        } else if (keyLc.includes('stats')) {
          card.stats = value;
        } else if (keyLc.includes('power')) {
          card.text = value; // Use power as text for heroes
        }
      }
      card.id = `${card.type}-${slugify(card.name)}`;
      out.push(card);
    }
  }
  return out;
}

function main() {
  const root = process.cwd();
  const mdPath = path.join(root, 'CARDS.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  const cards = parse(md);
  const outPath = path.join(root, 'data', 'cards.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(cards, null, 2));
  console.log(`[cards-ingest] Wrote ${cards.length} cards ->`, path.relative(root, outPath));
}

if (process.argv[1] && process.argv[1].endsWith('cards-ingest.mjs')) main();
export { parse };
