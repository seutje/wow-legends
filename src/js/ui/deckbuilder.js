import { cardTooltip } from './cardTooltip.js';

export function renderDeckBuilder(container, { state, allCards, onChange }) {
  container.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Deck Builder';
  container.appendChild(h);
  const count = document.createElement('div');
  count.textContent = `Hero: ${state.hero ? state.hero.name : 'None'} | Cards: ${state.cards.length}/60`;
  container.appendChild(count);
  const pool = document.createElement('div');
  for (const card of allCards) {
    const tip = cardTooltip(card);
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
  const ul = document.createElement('ul');
  for (const c of state.cards) {
    const li = document.createElement('li');
    li.textContent = c.name;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}
