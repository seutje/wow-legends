import fs from 'fs';
import Game from '../src/js/game.js';
import { RNG } from '../src/js/utils/rng.js';

const deckDirUrl = new URL('../data/decks/', import.meta.url);

function sanitizeNames(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    let trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase().endsWith('.json')) trimmed = trimmed.slice(0, -5);
    if (!trimmed) continue;
    seen.add(trimmed);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function loadDeckNames() {
  try {
    const indexUrl = new URL('../data/decks/index.json', import.meta.url);
    const raw = JSON.parse(fs.readFileSync(indexUrl, 'utf8'));
    const names = sanitizeNames(raw);
    if (names.length) return names;
  } catch {}

  try {
    const files = fs.readdirSync(deckDirUrl);
    const names = sanitizeNames(files);
    if (names.length) return names;
  } catch {}

  return ['deck1', 'deck2', 'deck3', 'deck4', 'deck5'];
}

const deckDefinitions = loadDeckNames()
  .map((name) => {
    try {
      const url = new URL(`../data/decks/${name}.json`, import.meta.url);
      const raw = JSON.parse(fs.readFileSync(url, 'utf8'));
      if (!raw || typeof raw.hero !== 'string' || !Array.isArray(raw.cards)) return null;
      const counts = new Map();
      for (const id of raw.cards) {
        if (typeof id !== 'string' || !id) return null;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      return { hero: raw.hero, counts };
    } catch {
      return null;
    }
  })
  .filter(Boolean);

if (deckDefinitions.length === 0) {
  throw new Error('Expected at least one prebuilt AI deck definition');
}

function mapFromCards(cards) {
  const counts = new Map();
  for (const card of cards) {
    const id = card?.id;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a.entries()) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

function expectDeckMatchesPrebuilt(cards, heroId) {
  const counts = mapFromCards(cards);
  const match = deckDefinitions.some((def) => def.hero === heroId && mapsEqual(def.counts, counts));
  expect(match).toBe(true);
}

describe('training decks', () => {
  function expectDeckToRespectLimits(cards) {
    expect(Array.isArray(cards)).toBe(true);
    expect(cards).toHaveLength(60);

    const counts = new Map();
    const equipmentIds = new Set();
    let allyCount = 0;

    for (const card of cards) {
      expect(card).toBeTruthy();
      const prev = counts.get(card.id) || 0;
      const next = prev + 1;
      counts.set(card.id, next);
      expect(next).toBeLessThanOrEqual(3);
      if (card.type === 'ally') allyCount += 1;
      if (card.type === 'equipment') equipmentIds.add(card.id);
      expect(card.type).not.toBe('quest');
    }

    expect(allyCount).toBeGreaterThanOrEqual(30);
    expect(equipmentIds.size).toBeLessThanOrEqual(1);
  }

  it('use deckbuilder random fill limits for AI training decks', async () => {
    const game = new Game(null, { aiPlayers: ['player', 'opponent'] });
    game.rng = new RNG(1234);
    await game.setupMatch();

    expect(game.player.hero).toBeTruthy();
    expect(game.opponent.hero).toBeTruthy();
    const playerDeckCards = [...game.player.library.cards, ...game.player.hand.cards];
    const opponentDeckCards = [...game.opponent.library.cards, ...game.opponent.hand.cards];
    expectDeckToRespectLimits(playerDeckCards);
    expectDeckToRespectLimits(opponentDeckCards);
    expectDeckMatchesPrebuilt(playerDeckCards, game.player.hero.id);
    expectDeckMatchesPrebuilt(opponentDeckCards, game.opponent.hero.id);
  });

  it('selects deterministic AI decks when seeded', async () => {
    async function snapshot(seed) {
      const g = new Game(null, { aiPlayers: ['player', 'opponent'] });
      g.rng = new RNG(seed);
      await g.setupMatch();
      const cards = [...g.player.library.cards, ...g.player.hand.cards];
      return { hero: g.player.hero.id, counts: mapFromCards(cards) };
    }

    const first = await snapshot(42);
    const second = await snapshot(42);
    expect(first.hero).toBe(second.hero);
    expect(mapsEqual(first.counts, second.counts)).toBe(true);
  });
});
