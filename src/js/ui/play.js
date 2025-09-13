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

// Build a static card element that uses the same visual as tooltips
function buildCardEl(card) {
  const tooltipCard = card.summonedBy || card;
  const wrap = el('div', { class: 'card-tooltip' });

  const art = new Image();
  art.className = 'card-art';
  art.alt = tooltipCard.name;
  art.onload = () => {};
  art.onerror = () => { art.remove(); };

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
  wrap.append(art, frame, info);

  if (tooltipCard.type === 'hero' && tooltipCard.data?.armor != null) {
    const armorEl = el('div', { class: 'stat armor' }, tooltipCard.data.armor);
    wrap.append(armorEl);
  } else if (tooltipCard.cost != null) {
    wrap.append(el('div', { class: 'stat cost' }, tooltipCard.cost));
  }
  if (card.data?.attack != null) wrap.append(el('div', { class: 'stat attack' }, card.data.attack));
  if (card.data?.health != null) wrap.append(el('div', { class: 'stat health' }, card.data.health));

  art.src = `src/assets/art/${tooltipCard.id}-art.png`;
  return wrap;
}

function zoneCards(title, cards, { clickCard } = {}) {
  const wrap = el('div', { class: 'cards' });
  for (const c of cards) {
    const cardEl = buildCardEl(c);
    cardEl.dataset.cardId = c.id;
    if (clickCard) cardEl.addEventListener('click', async () => { await clickCard(c); });
    wrap.append(cardEl);
  }
  return el('section', { class: 'zone' }, el('h3', {}, title), wrap);
}

function logPane(title, entries = []) {
  const ul = el('ul', {}, ...entries.map(e => el('li', {}, e)));
  const pane = el('div', { class: 'log-pane zone' }, el('h3', {}, title), ul);
  // Ensure the latest entries are visible
  setTimeout(() => { ul.scrollTop = ul.scrollHeight; });
  return pane;
}

export function renderPlay(container, game, { onUpdate } = {}) {
  const p = game.player; const e = game.opponent;
  container.innerHTML = '';


  const header = el('div', { class: 'hud' },
    el('strong', {}, t('app_title')), ' — ',
    `Your HP ${p.hero.data.health} (Armor ${p.hero.data.armor}) | Enemy HP ${e.hero.data.health} (Armor ${e.hero.data.armor}) | Pool ${game.resources.pool(p)} / ${game.resources.available(p)}`
  );

  const controls = el('div', { class: 'controls' },
    el('button', { onclick: () => { onUpdate?.(); } }, 'Refresh'),
    el('button', { onclick: async () => { await game.useHeroPower(p); onUpdate?.(); }, disabled: p.hero.powerUsed || game.resources.pool(p) < 2 || p.hero.data.freezeTurns > 0 }, 'Hero Power'),
    el('button', { onclick: async () => { await game.endTurn(); onUpdate?.(); } }, 'End Turn')
  );

  const board = el('div', { class: 'board' });

  // AI side
  const aiHero = el('div', { class: 'slot ai-hero' }, el('h3', {}, 'AI hero'), buildCardEl(e.hero));
  const aiMana = el('div', { class: 'slot ai-mana' }, el('h3', {}, 'Mana'), el('div', {}, `${game.resources.pool(e)} / ${game.resources.available(e)}`));
  const aiLog = logPane('Enemy Log', e.log); aiLog.classList.add('ai-log');
  const aiHand = el('div', { class: 'zone ai-hand' }, el('h3', {}, 'Enemy Hand'), el('p', {}, `${e.hand.size()} cards`));
  const aiField = zoneCards('Enemy Battlefield', e.battlefield.cards, {}); aiField.classList.add('ai-field');

  // Player side
  const pHero = el('div', { class: 'slot p-hero' }, el('h3', {}, 'Player hero'), buildCardEl(p.hero));
  pHero.querySelector('.card-tooltip')?.addEventListener('click', async () => { await game.attack(p, p.hero.id); onUpdate?.(); });
  const pMana = el('div', { class: 'slot p-mana' }, el('h3', {}, 'Mana'), el('div', {}, `${game.resources.pool(p)} / ${game.resources.available(p)}`));
  const pLog = logPane('Player Log', p.log); pLog.classList.add('p-log');
  const pField = zoneCards('Player Battlefield', p.battlefield.cards, { clickCard: async (c)=>{ await game.attack(p, c.id); onUpdate?.(); } }); pField.classList.add('p-field');
  const pHand = zoneCards('Player Hand', p.hand.cards, { clickCard: async (c)=>{ if (!await game.playFromHand(p, c.id)) { /* ignore */ } onUpdate?.(); } }); pHand.classList.add('p-hand');

  board.append(aiHero, aiMana, aiHand, aiField, aiLog, pHero, pMana, pField, pHand, pLog);

  container.append(header, controls, board);

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
