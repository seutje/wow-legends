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

function logPane(title, entries = []) {
  const ul = el('ul', {}, ...entries.map(e => el('li', {}, e)));
  return el('div', { class: 'log-pane' }, el('h3', {}, title), ul);
}

export function renderPlay(container, game, { onUpdate } = {}) {
  const p = game.player; const e = game.opponent;
  container.innerHTML = '';

  let tooltipEl = null; // To store the tooltip element
  let armorInterval = null; // Interval for updating hero armor in tooltip

  function showTooltip(card, event, game) {
    if (tooltipEl) hideTooltip(); // Hide any existing tooltip
    const tooltipCard = card.summonedBy || card;

    tooltipEl = el('div', { class: 'card-tooltip' });
    const currentTooltip = tooltipEl;
    currentTooltip.style.position = 'absolute';
    currentTooltip.style.zIndex = '1000';
    currentTooltip.style.maxWidth = `${window.innerWidth - 20}px`;
    currentTooltip.style.maxHeight = `${window.innerHeight - 20}px`;
    container.append(currentTooltip);

    function position() {
      currentTooltip.style.left = `${event.clientX + 10}px`;
      currentTooltip.style.top = `${event.clientY + 10}px`;
      const rect = currentTooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        currentTooltip.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      if (rect.bottom > window.innerHeight) {
        currentTooltip.style.top = `${window.innerHeight - rect.height - 10}px`;
      }
    }

    const art = new Image();
    art.className = 'card-art';
    art.alt = tooltipCard.name;

    const frame = new Image();
    frame.className = 'card-frame';
    frame.src = 'src/assets/frame.png';

    const infoChildren = [
      el('div', { class: 'card-type' }, tooltipCard.type),
      el('h4', {}, tooltipCard.name),
      el('p', { class: 'card-text' }, tooltipCard.text)
    ];
    if (tooltipCard.keywords?.length) {
      infoChildren.push(el('p', { class: 'card-keywords' }, tooltipCard.keywords.join(', ')));
    }
    const info = el('div', { class: 'card-info' }, ...infoChildren);

    currentTooltip.append(art, frame, info);

    if (tooltipCard.type === 'hero' && tooltipCard.data?.armor != null) {
      const armorEl = el('div', { class: 'stat armor' }, tooltipCard.data.armor);
      currentTooltip.append(armorEl);
      let lastArmor = tooltipCard.data.armor;
      armorInterval = setInterval(() => {
        if (!tooltipEl) { clearInterval(armorInterval); armorInterval = null; return; }
        if (tooltipCard.data.armor !== lastArmor) {
          lastArmor = tooltipCard.data.armor;
          armorEl.textContent = tooltipCard.data.armor;
        }
      }, 100);
    } else if (tooltipCard.cost != null) {
      currentTooltip.append(el('div', { class: 'stat cost' }, tooltipCard.cost));
    }
    if (card.data?.attack != null) currentTooltip.append(el('div', { class: 'stat attack' }, card.data.attack));
    if (card.data?.health != null) currentTooltip.append(el('div', { class: 'stat health' }, card.data.health));

    art.onload = () => { if (tooltipEl === currentTooltip) position(); };
    art.onerror = () => { if (tooltipEl === currentTooltip) { art.remove(); position(); } };

    art.src = `src/assets/art/${tooltipCard.id}-art.png`;
    position();
  }

  function hideTooltip() {
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
      tooltipEl = null;
    }
    if (armorInterval) {
      clearInterval(armorInterval);
      armorInterval = null;
    }
  }

  const header = el('div', { class: 'hud' },
    el('strong', {}, t('app_title')), ' — ',
    `Your HP ${p.hero.data.health} (Armor ${p.hero.data.armor}) | Enemy HP ${e.hero.data.health} (Armor ${e.hero.data.armor}) | Pool ${game.resources.pool(p)} / ${game.resources.available(p)}`
  );

  const controls = el('div', { class: 'controls' },
    el('button', { onclick: () => { onUpdate?.(); } }, 'Refresh'),
    el('button', { onclick: async () => { await game.useHeroPower(p); onUpdate?.(); }, disabled: p.hero.powerUsed || game.resources.pool(p) < 2 }, 'Hero Power'),
    el('button', { onclick: async () => { await game.endTurn(); onUpdate?.(); } }, 'End Turn')
  );

  const playerRow = el('div', { class: 'row player' },
    logPane('Player Log', p.log),
    el('div', { class: 'zone' }, zoneList('Player Battlefield', [p.hero, ...p.battlefield.cards], { clickCard: async (c)=>{ await game.attack(p, c.id); onUpdate?.(); }, game: game, showTooltip: showTooltip, hideTooltip: hideTooltip })),
    el('div', { class: 'zone' }, zoneList('Player Hand', p.hand.cards, { clickCard: async (c)=>{ if (!await game.playFromHand(p, c.id)) { /* ignore */ } onUpdate?.(); }, game: game, showTooltip: showTooltip, hideTooltip: hideTooltip }))
  );
  const enemyRow = el('div', { class: 'row enemy' },
    logPane('Enemy Log', e.log),
    el('div', { class: 'zone' }, zoneList('Enemy Battlefield', [e.hero, ...e.battlefield.cards], { game: game, showTooltip: showTooltip, hideTooltip: hideTooltip })),
    el('div', { class: 'zone' }, el('h3', {}, 'Enemy Hand'), el('p', {}, `${e.hand.size()} cards`))
  );

  container.append(header, controls, enemyRow, playerRow);

  const pDead = p.hero.data.health <= 0;
  const eDead = e.hero.data.health <= 0;
  if (pDead || eDead) {
    const msg = pDead ? 'You lose!' : 'You win!';
    const dialog = el('div', { class: 'game-over' },
      el('div', {},
        el('p', {}, msg),
        el('button', { onclick: async () => { await game.reset(); onUpdate?.(); } }, 'Restart')
      )
    );
    container.append(dialog);
  }
}

