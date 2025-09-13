// Simple fuzzy matching utilities for deck search

function normalize(s) {
  return (s ?? '').toString().toLowerCase();
}

export function fuzzyMatch(query, text) {
  const q = normalize(query).trim();
  const t = normalize(text);
  if (!q) return true;
  if (!t) return false;
  // simple case-insensitive substring match
  return t.includes(q);
}

export function filterCards(allCards, query) {
  const q = normalize(query).trim();
  if (!q) return allCards;
  const tokens = q.split(/\s+/).filter(Boolean);
  return allCards.filter((card) => {
    const haystacks = [card.name, card.type, ...(card.keywords || [])].map(normalize);
    // every token must match at least one haystack
    return tokens.every((tok) => haystacks.some((h) => fuzzyMatch(tok, h)));
  });
}

export default { fuzzyMatch, filterCards };
