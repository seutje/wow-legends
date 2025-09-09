import { t } from '../i18n/strings.js';

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else if (typeof v === 'boolean') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

function zoneList(title, cards, { clickCard, game, showTooltip, hideTooltip } = {}) {
  const ul = el('ul', { class: 'zone-list' });
  for (const c of cards) {
    const cost = c.cost != null ? ` (${c.cost})` : '';
    const li = el('li', { dataset: { cardId: c.id } }, `${c.name}${cost}`);
    if (clickCard) li.addEventListener('click', async () => { await clickCard(c); });

    // Add mouseenter and mouseleave listeners to prevent duplicate tooltips
    li.addEventListener('mouseenter', (e) => showTooltip(c, e, game));
    li.addEventListener('mouseleave', () => hideTooltip());

    ul.append(li);
  }
  return el('section', {}, el('h3', {}, title), ul);
}

function heroPane(hero) {
  const abilities = [];
  if (hero.text) abilities.push(el('p', { class: 'ability-text' }, hero.text));
  if (hero.keywords?.length) {
    const ul = el('ul', { class: 'abilities' }, ...hero.keywords.map(k => el('li', {}, k)));
    abilities.push(ul);
  }
  return el('div', { class: 'hero-pane' },
    el('h3', {}, hero.name),
    el('p', {}, `Health: ${hero.data.health} Armor: ${hero.data.armor}`),
    ...abilities
  );
}

export function renderPlay(container, game, { onUpdate } = {}) {
  const p = game.player; const e = game.opponent;
  container.innerHTML = '';

  let tooltipEl = null; // To store the tooltip element

  function showTooltip(card, event, game) {
    if (tooltipEl) hideTooltip(); // Hide any existing tooltip

    tooltipEl = el('div', { class: 'card-tooltip' });
    tooltipEl.style.position = 'absolute';
    tooltipEl.style.zIndex = '1000';
    tooltipEl.style.maxWidth = `${window.innerWidth - 20}px`;
    tooltipEl.style.maxHeight = `${window.innerHeight - 20}px`;
    container.append(tooltipEl);

    function position() {
      tooltipEl.style.left = `${event.clientX + 10}px`;
      tooltipEl.style.top = `${event.clientY + 10}px`;
      const rect = tooltipEl.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        tooltipEl.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      if (rect.bottom > window.innerHeight) {
        tooltipEl.style.top = `${window.innerHeight - rect.height - 10}px`;
      }
    }

    const img = new Image();
    img.alt = card.name;
    img.onload = () => {
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      tooltipEl.append(img);
      position();
    };
    img.onerror = () => {
      tooltipEl.textContent = card.text;
      tooltipEl.style.backgroundColor = 'rgba(0,0,0,0.8)';
      tooltipEl.style.color = 'white';
      tooltipEl.style.padding = '5px';
      tooltipEl.style.borderRadius = '3px';
      position();
    };
    img.src = `src/assets/cards/${card.id}.png`;
    position();
  }

  function hideTooltip() {
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
      tooltipEl = null;
    }
  }

  const header = el('div', { class: 'hud' },
    el('strong', {}, t('app_title')), ' — ',
    `Your HP ${p.hero.data.health} (Armor ${p.hero.data.armor}) | Enemy HP ${e.hero.data.health} (Armor ${e.hero.data.armor}) | Pool ${game.resources.pool(p)} / ${game.resources.available(p)}`
  );

  const controls = el('div', { class: 'controls' },
    el('button', { onclick: () => { game.draw(p, 1); onUpdate?.(); } }, 'Draw'),
    el('button', { onclick: () => { onUpdate?.(); } }, 'Refresh'),
    el('button', { onclick: () => { game.resolveCombat(p, e); onUpdate?.(); } }, 'Resolve Combat'),
    el('button', { onclick: async () => { await game.useHeroPower(p); onUpdate?.(); }, disabled: p.hero.powerUsed || game.resources.pool(p) < 2 }, 'Hero Power'),
    el('button', { onclick: async () => { await game.endTurn(); onUpdate?.(); } }, 'End Turn')
  );

  const playerRow = el('div', { class: 'row player' },
    heroPane(p.hero),
    el('div', { class: 'zone' }, zoneList('Player Battlefield', [p.hero, ...p.battlefield.cards], { clickCard: (c)=>{ game.toggleAttacker(p, c.id); onUpdate?.(); }, game: game, showTooltip: showTooltip, hideTooltip: hideTooltip })),
    el('div', { class: 'zone' }, zoneList('Player Hand', p.hand.cards, { clickCard: async (c)=>{ if (!await game.playFromHand(p, c.id)) { /* ignore */ } onUpdate?.(); }, game: game, showTooltip: showTooltip, hideTooltip: hideTooltip }))
  );
  const enemyRow = el('div', { class: 'row enemy' },
    heroPane(e.hero),
    el('div', { class: 'zone' }, zoneList('Enemy Battlefield', [e.hero, ...e.battlefield.cards], { game: game, showTooltip: showTooltip, hideTooltip: hideTooltip })),
    el('div', { class: 'zone' }, el('h3', {}, 'Enemy Hand'), el('p', {}, `${e.hand.size()} cards`))
  );

  container.append(header, controls, enemyRow, playerRow);
}

