import Card from '../entities/card.js';

export function renderDeckBuilder(container, { deck, onChange }) {
  container.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = 'Deck Builder'; container.appendChild(h);
  const count = document.createElement('div'); count.textContent = `Cards: ${deck.length}`; container.appendChild(count);
  const input = document.createElement('input'); input.placeholder = 'Card name';
  const add = document.createElement('button'); add.textContent = 'Add';
  add.onclick = () => {
    if (!input.value) return;
    deck.push(new Card({ type: 'ally', name: input.value }));
    input.value='';
    onChange?.();
  };
  container.appendChild(input); container.appendChild(add);
  const ul = document.createElement('ul');
  for (const c of deck) { const li = document.createElement('li'); li.textContent = c.name; ul.appendChild(li); }
  container.appendChild(ul);
}

