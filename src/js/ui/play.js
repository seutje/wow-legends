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

function cardEl(card, { onClick } = {}) {
  const tooltipCard = card.summonedBy || card;
  const wrap = el('div', { class: 'card-tooltip', dataset: { cardId: card.id } });
  if (onClick) wrap.addEventListener('click', () => onClick(card));

  const art = new Image();
  art.className = 'card-art';
  art.alt = tooltipCard.name;
  art.src = `src/assets/art/${tooltipCard.id}-art.png`;

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
    wrap.append(el('div', { class: 'stat armor' }, tooltipCard.data.armor));
  } else if (tooltipCard.cost != null) {
    wrap.append(el('div', { class: 'stat cost' }, tooltipCard.cost));
  }
  if (card.data?.attack != null) wrap.append(el('div', { class: 'stat attack' }, card.data.attack));
  if (card.data?.health != null) wrap.append(el('div', { class: 'stat health' }, card.data.health));

  return wrap;
}

function cardZone(cards, { clickCard } = {}) {
  const zone = el('div', { class: 'card-zone' });
  for (const c of cards) zone.append(cardEl(c, { onClick: clickCard }));
  return zone;
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

  const enemyDeck = el('div', { class: 'zone enemy-deck' },
    el('h3', {}, 'Enemy Deck'),
    el('p', {}, `${e.library?.size ? e.library.size() : 0} cards`)
  );

  const enemyHero = el('div', { class: 'zone enemy-hero' }, cardEl(e.hero));

  const enemyHand = el('div', { class: 'zone enemy-hand' },
    el('h3', {}, 'Enemy Hand'),
    el('p', {}, `${e.hand.size()} cards`)
  );

  const enemyField = el('div', { class: 'zone enemy-battlefield' },
    cardZone(e.battlefield.cards)
  );

  const playerField = el('div', { class: 'zone player-battlefield' },
    cardZone(p.battlefield.cards, { clickCard: async (c) => { await game.attack(p, c.id); onUpdate?.(); } })
  );

  const playerHand = el('div', { class: 'zone player-hand' },
    cardZone(p.hand.cards, { clickCard: async (c) => { if (!await game.playFromHand(p, c.id)) { /* ignore */ } onUpdate?.(); } })
  );

  const playerHero = el('div', { class: 'zone player-hero' },
    cardEl(p.hero, { onClick: async () => { await game.attack(p, p.hero.id); onUpdate?.(); } })
  );

  const playerDeck = el('div', { class: 'zone player-deck' },
    el('h3', {}, 'Player Deck'),
    el('p', {}, `${p.library?.size ? p.library.size() : 0} cards`)
  );

  const enemyLogPane = logPane('Enemy Log', e.log);
  enemyLogPane.classList.add('enemy-log');

  const playerLogPane = logPane('Player Log', p.log);
  playerLogPane.classList.add('player-log');

  const board = el('div', { class: 'board' },
    enemyDeck,
    enemyHero,
    enemyHand,
    enemyField,
    playerField,
    playerHand,
    playerHero,
    playerDeck,
    enemyLogPane,
    playerLogPane
  );

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

