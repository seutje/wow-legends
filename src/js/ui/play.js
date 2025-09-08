import { t } from '../i18n/strings.js';

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'dataset') Object.assign(e.dataset, v); else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

function zoneList(title, cards, { clickCard, game } = {}) {
  const ul = el('ul', { class: 'zone-list' });
  for (const c of cards) {
    const cost = c.cost != null ? ` (${c.cost})` : '';
    const li = el('li', { dataset: { cardId: c.id } }, `${c.name}${cost}`);
    if (clickCard) li.addEventListener('click', () => clickCard(c));

    // Add mouseover and mouseout listeners
    li.addEventListener('mouseover', (e) => showTooltip(c, e, game));
    li.addEventListener('mouseout', () => hideTooltip());

    ul.append(li);
  }
  return el('section', {}, el('h3', {}, title), ul);
}

export function renderPlay(container, game, { onUpdate } = {}) {
  const p = game.player; const e = game.opponent;
  container.innerHTML = '';

  let tooltipEl = null; // To store the tooltip element

  function showTooltip(card, event, game) {
    if (tooltipEl) hideTooltip(); // Hide any existing tooltip

    if (!card.text) return; // No text to show

    tooltipEl = el('div', { class: 'card-tooltip' }, card.text);
    container.append(tooltipEl);

    // Position the tooltip (simple positioning for now)
    tooltipEl.style.position = 'absolute';
    tooltipEl.style.left = `${event.clientX + 10}px`;
    tooltipEl.style.top = `${event.clientY + 10}px`;
    tooltipEl.style.backgroundColor = 'rgba(0,0,0,0.8)';
    tooltipEl.style.color = 'white';
    tooltipEl.style.padding = '5px';
    tooltipEl.style.borderRadius = '3px';
    tooltipEl.style.zIndex = '1000';
  }

  function hideTooltip() {
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
      tooltipEl = null;
    }
  }

  const header = el('div', { class: 'hud' },
    el('strong', {}, t('app_title')), ' — ',
    `Your HP ${p.hero.data.health} | Enemy HP ${e.hero.data.health} | Pool ${game.resources.pool(p)} / ${game.resources.available(p)}`
  );

  const controls = el('div', { class: 'controls' },
    el('button', { onclick: () => { game.draw(p, 1); onUpdate?.(); } }, 'Draw'),
    el('button', { onclick: () => { onUpdate?.(); } }, 'Refresh'),
    el('button', { onclick: () => { game.resolveCombat(p, e); onUpdate?.(); } }, 'Resolve Combat'),
    el('button', { onclick: () => { game.endTurn(); onUpdate?.(); } }, 'End Turn')
  );

  const playerRow = el('div', { class: 'row player' },
    el('div', { class: 'zone' }, zoneList('Player Battlefield', p.battlefield.cards, { clickCard: (c)=>{ game.toggleAttacker(p, c.id); onUpdate?.(); }, game: game })),
    el('div', { class: 'zone' }, zoneList('Player Hand', p.hand.cards, { clickCard: (c)=>{ if (!game.playFromHand(p, c.id)) { /* ignore */ } onUpdate?.(); }, game: game }))
  );
  const enemyRow = el('div', { class: 'row enemy' },
    el('div', { class: 'zone' }, zoneList('Enemy Battlefield', e.battlefield.cards, { game: game })),
    el('div', { class: 'zone' }, el('h3', {}, 'Enemy Hand'), el('p', {}, `${e.hand.size()} cards`))
  );

  container.append(header, controls, enemyRow, playerRow);
}

