import { cardTooltip } from './cardTooltip.js';
import { filterCards } from '../utils/fuzzy.js';

export function renderDeckBuilder(container, { state, allCards, onChange }) {
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
  // We do not call onChange here to avoid re-render and input blur.
  search.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    filterPool(state.searchQuery);
  });
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
        state.cards.push(card);
      }
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
  // Apply initial filter if any
  if (state.searchQuery) filterPool(state.searchQuery);
  const ul = document.createElement('ul');
  for (const c of state.cards) {
    const li = document.createElement('li');
    li.textContent = c.name;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}
