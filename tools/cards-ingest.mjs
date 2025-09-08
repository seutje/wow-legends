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
        effects: [],
        keywords: [],
        stats: undefined,
        data: {}
      };

      let rawText = '';

      for (const line of blockLines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        const keyLc = key.toLowerCase().trim();

        if (keyLc.includes('type')) {
          let type = value.split('—')[0].trim().toLowerCase();
          if (type === 'ability') {
            card.type = 'spell';
          } else {
            card.type = type;
          }
        } else if (keyLc.includes('cost')) {
          const costMatch = value.match(/(\d+)/);
          if (costMatch) card.cost = Number(costMatch[1]);
        } else if (keyLc.includes('text')) {
          rawText = value;
        } else if (keyLc.includes('keywords')) {
          card.keywords = value.split(',').map(k => k.trim()).filter(Boolean);
        } else if (keyLc.includes('stats')) {
          const statsMatch = value.match(/(\d+)\s*ATK\s*\/\s*(\d+)\s*HP/i);
          if (statsMatch) {
            card.data = {
              attack: parseInt(statsMatch[1], 10),
              health: parseInt(statsMatch[2], 10)
            };
          }
        } else if (keyLc.includes('power')) {
          rawText = value; // Use power as text for heroes
        }

        // Special handling for hero power text
        if (card.type === 'hero' && line.includes('Power (')) {
          const powerMatch = line.match(/Power \((\d+)\):\s*(.*)/);
          if (powerMatch) {
            rawText = powerMatch[1].trim();
          }
        }
      }
      card.id = `${card.type}-${slugify(card.name)}`;
      card.effects = parseEffect(rawText, card);
      out.push(card);
    }
  }
  return out;
}

function parseEffect(text, card) {
  const effects = [];

  // Damage effects
  let match = text.match(/Deal (\d+) damage to (any target|all characters|all enemies|a minion|the enemy hero or a minion without Taunt)\.?/i);
  if (match) {
    const amount = parseInt(match[1], 10);
    let target = match[2].toLowerCase();
    if (target === 'any target') target = 'any';
    if (target === 'all characters') target = 'allCharacters';
    if (target === 'all enemies') target = 'allEnemies';
    if (target === 'a minion') target = 'minion';
    if (target === 'the enemy hero or a minion without taunt') target = 'enemyHeroOrMinionWithoutTaunt'; // This will need special handling in game logic

    effects.push({ type: 'damage', target, amount });
  }

  // Summon effects
  match = text.match(/Summon (a|two) (\d+)\/(\d+) (.+?)(?: with “(.+?)”|\.)?/i);
  if (match) {
    const count = match[1] === 'a' ? 1 : 2;
    const attack = parseInt(match[2], 10);
    const health = parseInt(match[3], 10);
    const name = match[4].trim();
    const keywords = match[5] ? match[5].split(',').map(k => k.trim()) : [];
    effects.push({ type: 'summon', unit: { name, attack, health, keywords }, count });
  }

  // Buff effects (simple ATK buff)
  match = text.match(/Give your hero and allies \+(\d+) ATK this turn/i);
  if (match) {
    const amount = parseInt(match[1], 10);
    effects.push({ type: 'buff', target: 'allies', property: 'attack', amount, duration: 'thisTurn' });
  }

  // Overload
  match = text.match(/Overload \((\d+)\)/i);
  if (match) {
    const amount = parseInt(match[1], 10);
    effects.push({ type: 'overload', amount });
  }

  // Heal effects
  match = text.match(/Restore (\d+) HP to a character/i);
  if (match) {
    const amount = parseInt(match[1], 10);
    effects.push({ type: 'heal', target: 'character', amount });
  }

  // Draw effects
  match = text.match(/Draw a card/i);
  if (match) {
    effects.push({ type: 'draw', count: 1 });
  }

  // Destroy effects
  match = text.match(/Destroy a minion with (\d+) or less ATK/i);
  if (match) {
    const amount = parseInt(match[1], 10);
    effects.push({ type: 'destroy', target: 'minion', condition: { type: 'attackLessThan', amount } });
  }

  // Return to Hand effects
  match = text.match(/Return an enemy ally to its owner’s hand; it costs \((\d+)\) more next time/i);
  if (match) {
    const costIncrease = parseInt(match[1], 10);
    effects.push({ type: 'returnToHand', target: 'enemyAlly', costIncrease });
  }

  // Transform effects
  match = text.match(/Transform a random ally into a (\d+)\/(\d+) (.+?) with (.+?) until end of turn/i);
  if (match) {
    const attack = parseInt(match[1], 10);
    const health = parseInt(match[2], 10);
    const name = match[3].trim();
    const keywords = match[4].split(',').map(k => k.trim());
    effects.push({ type: 'transform', target: 'randomAlly', into: { name, attack, health, keywords }, duration: 'endOfTurn' });
  }

  // If no specific effect is parsed, store the raw text as a generic effect
  if (effects.length === 0 && text.trim().length > 0) {
    effects.push({ type: 'rawText', text: text.trim() });
  }

  return effects;
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
