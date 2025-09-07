#!/usr/bin/env node
// Parse CARDS.md sections → JSON (best-effort)
import fs from 'fs';
import path from 'path';

function parse(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    // Very naive pattern: "- Name (Type) - Cost X"
    const m = line.match(/^\s*-\s*([^\(\-]+)\s*\(([^\)]+)\)/i);
    if (m) {
      const name = m[1].trim();
      const typeRaw = m[2].trim().toLowerCase();
      const map = { ally: 'ally', spell: 'spell', equipment: 'equipment', quest: 'quest', consumable: 'consumable' };
      const type = map[typeRaw] || 'spell';
      const cm = line.match(/cost\s*(\d+)/i);
      const cost = cm ? Number(cm[1]) : undefined;
      out.push({ id: `${type}-${name.toLowerCase().replace(/\s+/g,'-')}` , name, type, ...(cost!=null?{cost}:{}), keywords: [] });
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
