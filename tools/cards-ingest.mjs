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
  const lines = md.split(/\r?\n/);
  const out = [];
  const skipPrefixes = ['type:', 'keywords:', 'systems:', 'stats:', 'health:', 'rarity:', 'text:', 'cost:', 'reward:', 'objective:'];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('-')) continue;
    // Pattern: "- Name (Type) - Cost X" (Name can include dashes)
    const m = line.match(/^\s*-\s*(.+?)\s*\(([^\)]+)\)/i);
    if (!m) continue;
    const name = m[1].trim();
    const nameLc = name.toLowerCase();
    if (skipPrefixes.some(p => nameLc.startsWith(p))) continue; // skip meta lines
    const typeRaw = m[2].trim().toLowerCase();
    const map = {
      ally: 'ally',
      spell: 'spell',
      ability: 'spell',
      equipment: 'equipment',
      quest: 'quest',
      consumable: 'consumable',
      hero: 'hero'
    };
    const type = map[typeRaw] || 'spell';
    const cm = line.match(/cost\s*:?\s*(\d+)/i);
    const cost = cm ? Number(cm[1]) : undefined;
    out.push({ id: `${type}-${slugify(name)}`, name, type, ...(cost!=null?{cost}:{}), keywords: [] });
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
