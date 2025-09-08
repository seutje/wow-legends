import Player from '../entities/player.js';

export function renderBoard(container, player) {
  container.innerHTML = '';
  const zones = [
    ['Library', player.library],
    ['Hand', player.hand],
    ['Resources', player.resourcesZone],
    ['Battlefield', { cards: [player.hero, ...player.battlefield.cards] }],
    ['Graveyard', player.graveyard],
  ];
  for (const [name, zone] of zones) {
    const section = document.createElement('section');
    const h = document.createElement('h3'); h.textContent = name; section.appendChild(h);
    const ul = document.createElement('ul'); ul.dataset.zone = name.toLowerCase(); ul.classList.add('zone-list');
    for (const c of zone.cards) {
      const li = document.createElement('li'); li.textContent = c.name; li.dataset.cardId = c.id; ul.appendChild(li);
    }
    section.appendChild(ul);
    container.appendChild(section);
  }
}

export function wireInteractions(container, player, { onChange } = {}) {
  container.addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    const zoneEl = li.closest('ul');
    if (!zoneEl) return;
    const zone = zoneEl.dataset.zone;
    const id = li.dataset.cardId;
    if (zone === 'library') {
      const [c] = player.library.draw(1);
      if (c) player.hand.add(c);
    } else if (zone === 'hand') {
      // Click card in hand to place as resource
      player.hand.moveTo(player.resourcesZone, id);
    }
    onChange?.();
  });
}

