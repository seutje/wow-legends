import { cardTooltip } from './cardTooltip.js';
import { filterCards } from '../utils/fuzzy.js';

export function renderDeckBuilder(container, {
  state,
  allCards,
  onChange,
  prebuiltDecks = [],
  onSelectPrebuilt = null,
  onSelectOpponent = null,
}) {
  const summarizeDeck = () => {
    const heroName = state.hero ? state.hero.name : 'None';
    const base = `Hero: ${heroName} | Cards: ${state.cards.length}/60`;
    if (state.selectedPrebuiltDeck) {
      let label = state.selectedPrebuiltDeck;
      if (Array.isArray(prebuiltDecks)) {
        const match = prebuiltDecks.find((deck) => deck?.name === state.selectedPrebuiltDeck);
        if (match) {
          if (match.name && match.hero?.name) label = `${match.name} (${match.hero.name})`;
          else if (match.name) label = match.name;
          else if (match.hero?.name) label = match.hero.name;
        }
      }
      return `${base} | Prefab: ${label}`;
    }
    return base;
  };
  // If already initialized, only update the dynamic parts (hero/count and deck list)
  if (container.__deckBuilder) {
    const {
      countEl,
      listEl,
      prebuiltSelectEl,
      updatePrebuiltOptions,
      opponentSelectEl,
      updateOpponentOptions,
    } = container.__deckBuilder;
    if (typeof updatePrebuiltOptions === 'function') updatePrebuiltOptions(prebuiltDecks);
    if (prebuiltSelectEl) {
      const desired = state.selectedPrebuiltDeck || '';
      if (prebuiltSelectEl.value !== desired) prebuiltSelectEl.value = desired;
    }
    if (typeof updateOpponentOptions === 'function') updateOpponentOptions(allCards);
    if (opponentSelectEl) {
      const desiredOpponent = state.selectedOpponentHeroId || '';
      if (opponentSelectEl.value !== desiredOpponent) opponentSelectEl.value = desiredOpponent;
    }
    countEl.textContent = summarizeDeck();
    // Rebuild list contents (cheap) without touching the card pool DOM
    listEl.innerHTML = '';
    for (const c of state.cards) {
      const li = document.createElement('li');
      li.textContent = c.name;
      listEl.appendChild(li);
    }
    return;
  }

  // First-time render: build static structure and store refs for incremental updates
  container.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Deck Builder';
  container.appendChild(h);

  // Search bar
  const searchWrap = document.createElement('div');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search cards (name, keywords)';
  search.value = state.searchQuery ?? '';
  searchWrap.appendChild(search);
  container.appendChild(searchWrap);

  const prebuiltWrap = document.createElement('div');
  const prebuiltLabel = document.createElement('label');
  prebuiltLabel.textContent = 'Prefab deck: ';
  const prebuiltSelect = document.createElement('select');
  prebuiltSelect.dataset.role = 'prebuilt-deck-select';
  const updatePrebuiltOptions = (decks = []) => {
    const safeDecks = Array.isArray(decks) ? decks : [];
    const descriptor = safeDecks.map((deck) => [deck?.name ? String(deck.name) : '', deck?.hero?.name ? String(deck.hero.name) : '']);
    const key = JSON.stringify(descriptor);
    if (prebuiltSelect.__optionsKey === key) return;
    prebuiltSelect.innerHTML = '';
    const customOption = document.createElement('option');
    customOption.value = '';
    customOption.textContent = 'Custom deck';
    prebuiltSelect.appendChild(customOption);
    for (const deck of safeDecks) {
      if (!deck) continue;
      const value = deck.name ? String(deck.name) : '';
      if (!value) continue;
      const option = document.createElement('option');
      option.value = value;
      const heroName = deck.hero?.name;
      if (deck.name && heroName) option.textContent = `${deck.name} (${heroName})`;
      else if (deck.name) option.textContent = deck.name;
      else if (heroName) option.textContent = heroName;
      else option.textContent = value;
      prebuiltSelect.appendChild(option);
    }
    prebuiltSelect.__optionsKey = key;
  };
  prebuiltLabel.appendChild(prebuiltSelect);
  prebuiltWrap.appendChild(prebuiltLabel);
  container.appendChild(prebuiltWrap);

  prebuiltSelect.addEventListener('change', (e) => {
    const value = e.target.value || '';
    const normalized = value || null;
    if ((state.selectedPrebuiltDeck || null) === normalized) return;
    onSelectPrebuilt?.(normalized);
  });

  updatePrebuiltOptions(prebuiltDecks);
  prebuiltSelect.value = state.selectedPrebuiltDeck || '';

  const opponentWrap = document.createElement('div');
  const opponentLabel = document.createElement('label');
  opponentLabel.textContent = 'Opponent deck: ';
  const opponentSelect = document.createElement('select');
  opponentSelect.dataset.role = 'opponent-deck-select';
  const updateOpponentOptions = (cards = []) => {
    const heroes = Array.isArray(cards) ? cards.filter((card) => card?.type === 'hero') : [];
    const sortedHeroes = heroes.slice().sort((a, b) => {
      const aLabel = a?.name ? String(a.name) : String(a?.id ?? '');
      const bLabel = b?.name ? String(b.name) : String(b?.id ?? '');
      return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base', numeric: true });
    });
    const descriptor = sortedHeroes.map((hero) => [hero?.id ? String(hero.id) : '', hero?.name ? String(hero.name) : '']);
    const key = JSON.stringify(descriptor);
    if (opponentSelect.__optionsKey === key) return;
    opponentSelect.innerHTML = '';
    const randomOption = document.createElement('option');
    randomOption.value = '';
    randomOption.textContent = 'Random';
    opponentSelect.appendChild(randomOption);
    for (const hero of sortedHeroes) {
      const id = hero?.id ? String(hero.id) : '';
      if (!id) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = hero?.name ? String(hero.name) : id;
      opponentSelect.appendChild(option);
    }
    opponentSelect.__optionsKey = key;
  };
  opponentLabel.appendChild(opponentSelect);
  opponentWrap.appendChild(opponentLabel);
  container.appendChild(opponentWrap);

  updateOpponentOptions(allCards);
  opponentSelect.value = state.selectedOpponentHeroId || '';

  opponentSelect.addEventListener('change', (e) => {
    const value = e.target.value || '';
    const normalized = value || null;
    if ((state.selectedOpponentHeroId || null) === normalized) return;
    onSelectOpponent?.(normalized);
  });

  const count = document.createElement('div');
  count.textContent = summarizeDeck();
  container.appendChild(count);

  const pool = document.createElement('div');
  for (const card of allCards) {
    const tip = cardTooltip(card);
    // Store card ref for filtering without re-rendering
    tip.__card = card;
    tip.style.display = 'inline-block';
    tip.style.margin = '4px';
    tip.addEventListener('click', () => {
      let changed = false;
      if (card.type === 'hero') {
        if (state.hero !== card) {
          state.hero = card;
          changed = true;
        }
      } else if (state.cards.length < 60) {
        if (card.type === 'quest' && state.cards.some(c => c.type === 'quest')) {
          return;
        }
        state.cards.push(card);
        changed = true;
      }
      if (!changed) return;
      state.selectedPrebuiltDeck = null;
      // Ask the host to update surrounding UI (buttons, etc.)
      onChange?.();
    });
    pool.appendChild(tip);
  }
  container.appendChild(pool);

  function filterPool(query) {
    const visible = new Set(filterCards(allCards, query).map(c => c.id));
    for (const tip of pool.children) {
      const id = tip.__card?.id;
      if (!query) {
        tip.removeAttribute('hidden');
        tip.style.display = 'inline-block';
      } else if (visible.has(id)) {
        tip.removeAttribute('hidden');
        tip.style.display = 'inline-block';
      } else {
        tip.setAttribute('hidden', '');
        tip.style.display = 'none';
      }
    }
  }

  // We do not call onChange for search updates to avoid re-render and input blur
  search.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    filterPool(state.searchQuery);
  });

  // Apply initial filter if any
  if (state.searchQuery) filterPool(state.searchQuery);

  const ul = document.createElement('ul');
  for (const c of state.cards) {
    const li = document.createElement('li');
    li.textContent = c.name;
    ul.appendChild(li);
  }
  container.appendChild(ul);

  // Save refs for incremental updates next time
  container.__deckBuilder = {
    countEl: count,
    listEl: ul,
    poolEl: pool,
    searchEl: search,
    prebuiltSelectEl: prebuiltSelect,
    updatePrebuiltOptions,
    opponentSelectEl: opponentSelect,
    updateOpponentOptions,
  };
}
