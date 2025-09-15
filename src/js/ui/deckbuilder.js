import { cardTooltip } from './cardTooltip.js';
import { filterCards } from '../utils/fuzzy.js';

export function renderDeckBuilder(container, { state, allCards, onChange }) {
  // If already initialized, only update the dynamic parts (hero/count and deck list)
  if (container.__deckBuilder) {
    const { countEl, listEl } = container.__deckBuilder;
    countEl.textContent = `Hero: ${state.hero ? state.hero.name : 'None'} | Cards: ${state.cards.length}/60`;
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

  const count = document.createElement('div');
  count.textContent = `Hero: ${state.hero ? state.hero.name : 'None'} | Cards: ${state.cards.length}/60`;
  container.appendChild(count);

  const pool = document.createElement('div');
  for (const card of allCards) {
    const tip = cardTooltip(card);
    // Store card ref for filtering without re-rendering
    tip.__card = card;
    tip.style.display = 'inline-block';
    tip.style.margin = '4px';
    tip.addEventListener('click', () => {
      if (card.type === 'hero') {
        state.hero = card;
      } else if (state.cards.length < 60) {
        if (card.type === 'quest' && state.cards.some(c => c.type === 'quest')) {
          return;
        }
        state.cards.push(card);
      }
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
  container.__deckBuilder = { countEl: count, listEl: ul, poolEl: pool, searchEl: search };
}
