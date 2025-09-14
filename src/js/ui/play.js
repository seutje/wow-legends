// No HUD title import needed

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
  {
    let triedOptim = false;
    art.onerror = () => {
      if (!triedOptim) {
        triedOptim = true;
        art.src = `src/assets/art/${tooltipCard.id}-art.png`;
      } else {
        art.remove();
      }
    };
  }

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

  art.src = `src/assets/optim/${tooltipCard.id}-art.png`;
  return wrap;
}

function zoneCards(title, cards, { clickCard } = {}) {
  const wrap = el('div', { class: 'cards' });
  const counts = new Map();
  for (const c of cards) {
    const n = (counts.get(c.id) || 0) + 1; counts.set(c.id, n);
    const key = `${c.id}#${n}`;
    const cardEl = buildCardEl(c);
    cardEl.dataset.cardId = c.id;
    cardEl.dataset.key = key;
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

function updateCardEl(cardEl, card) {
  if (!cardEl) return;
  const tooltipCard = card.summonedBy || card;
  // Update images if needed
  const art = cardEl.querySelector('img.card-art');
  if (art) {
    const desiredSrc = `src/assets/optim/${tooltipCard.id}-art.png`;
    // Rebind onerror to ensure fallback uses current id
    let triedOptim = false;
    art.onerror = () => {
      if (!triedOptim) {
        triedOptim = true;
        art.src = `src/assets/art/${tooltipCard.id}-art.png`;
      } else {
        art.remove();
      }
    };
    if (art.getAttribute('src') !== desiredSrc) art.src = desiredSrc;
    art.alt = tooltipCard.name;
  }
  // Frame is static

  // Update info fields
  const typeEl = cardEl.querySelector('.card-type');
  if (typeEl) typeEl.textContent = tooltipCard.type;
  const nameEl = cardEl.querySelector('h4');
  if (nameEl) nameEl.textContent = tooltipCard.name;
  const textEl = cardEl.querySelector('.card-text');
  if (textEl) textEl.textContent = tooltipCard.text ?? '';
  const kwEl = cardEl.querySelector('.card-keywords');
  if (kwEl) kwEl.textContent = (tooltipCard.keywords?.length ? tooltipCard.keywords.join(', ') : '');
  // Cost / armor may differ by type
  const costEl = cardEl.querySelector('.stat.cost');
  const armorEl = cardEl.querySelector('.stat.armor');
  if (tooltipCard.type === 'hero') {
    if (costEl) costEl.remove();
    if (armorEl) armorEl.textContent = String(tooltipCard.data?.armor ?? '');
  } else {
    if (armorEl) armorEl.remove();
    if (costEl && tooltipCard.cost != null) costEl.textContent = String(tooltipCard.cost);
  }
  const atkEl = cardEl.querySelector('.stat.attack');
  if (atkEl && card.data?.attack != null) atkEl.textContent = String(card.data.attack);
  const hpEl = cardEl.querySelector('.stat.health');
  if (hpEl && card.data?.health != null) hpEl.textContent = String(card.data.health);
}

function syncCardsSection(sectionEl, cards, { clickCard } = {}) {
  if (!sectionEl) return;
  const list = sectionEl.querySelector('.cards') || sectionEl;
  const byKey = new Map(Array.from(list.children).map(node => [node.dataset.key, node]));
  const seen = new Set();
  // Rebuild order with minimal moves; disambiguate duplicates by occurrence index
  const counts = new Map();
  let lastNode = null;
  for (const c of cards) {
    const n = (counts.get(c.id) || 0) + 1; counts.set(c.id, n);
    const key = `${c.id}#${n}`;
    seen.add(key);
    let node = byKey.get(key);
    if (!node) {
      node = buildCardEl(c);
      node.dataset.cardId = c.id;
      node.dataset.key = key;
      if (clickCard && !node.dataset.clickAttached) {
        node.addEventListener('click', async () => { await clickCard(c); });
        node.dataset.clickAttached = '1';
      }
    } else {
      updateCardEl(node, c);
      byKey.delete(key);
    }
    if (lastNode) {
      if (node.previousSibling !== lastNode) list.insertBefore(node, lastNode.nextSibling);
    } else if (node !== list.firstChild) {
      list.insertBefore(node, list.firstChild);
    }
    lastNode = node;
  }
  // Remove any remaining nodes (cards no longer present)
  for (const [k, node] of byKey) { if (!seen.has(k)) node.remove(); }
}

function syncLogPane(pane, entries = []) {
  if (!pane) return;
  const ul = pane.querySelector('ul');
  if (!ul) return;
  const wasAtBottom = (ul.scrollTop + ul.clientHeight) >= (ul.scrollHeight - 4);
  const items = Array.from(ul.children);
  // Append any new entries; if list shrank, rebuild simply
  if (entries.length < items.length) {
    ul.innerHTML = '';
    for (const e of entries) ul.append(el('li', {}, e));
  } else {
    for (let i = 0; i < entries.length; i++) {
      if (i < items.length) items[i].textContent = entries[i];
      else ul.append(el('li', {}, entries[i]));
    }
  }
  if (wasAtBottom) ul.scrollTop = ul.scrollHeight;
}

import { setDebugLogging, isDebugLogging } from '../utils/logger.js';

export function renderPlay(container, game, { onUpdate, onOpenDeckBuilder } = {}) {
  const p = game.player; const e = game.opponent;

  let controls = container.querySelector('.controls');
  let board = container.querySelector('.board');

  const initialMount = !controls || !board;
  if (initialMount) {
    container.innerHTML = '';
    const diffOptions = ['easy', 'medium', 'hard', 'nightmare'];
    const diffSelect = el('select', {
      class: 'select-difficulty',
      onchange: (e) => {
        const v = e.target.value;
        if (game.state) game.state.difficulty = v;
        onUpdate?.();
      }
    }, ...diffOptions.map(opt => el('option', { value: opt, selected: (game.state?.difficulty || 'easy') === opt }, opt.charAt(0).toUpperCase() + opt.slice(1))));

    // Debug checkbox (default off)
    const debugChk = el('input', { type: 'checkbox', class: 'chk-debug', onchange: (e) => {
      const on = !!e.target.checked;
      if (game.state) game.state.debug = on;
      setDebugLogging(on);
      onUpdate?.();
    } });
    debugChk.checked = !!(game.state?.debug);

    controls = el('div', { class: 'controls' },
      el('button', { class: 'btn-deck-builder', onclick: () => { onOpenDeckBuilder?.(); } }, 'Deck Builder'),
      el('button', { class: 'btn-hero-power', onclick: async () => { await game.useHeroPower(game.player); onUpdate?.(); } }, 'Hero Power'),
      el('button', { class: 'btn-end-turn', onclick: async (ev) => {
        const btn = ev?.currentTarget;
        if (btn) btn.disabled = true;
        if (game?.state) game.state.aiThinking = true;
        onUpdate?.();
        try {
          await game.endTurn();
        } finally {
          if (game?.state) game.state.aiThinking = false;
          if (btn) btn.disabled = false;
          onUpdate?.();
        }
      } }, 'End Turn'),
      el('label', { class: 'lbl-difficulty' }, 'Difficulty: ', diffSelect),
      el('label', { class: 'lbl-debug' }, debugChk, ' Debug logs')
    );
    board = el('div', { class: 'board' });

    // AI side
    const aiHero = el('div', { class: 'slot ai-hero' }, el('h3', {}, 'AI hero'), buildCardEl(e.hero));
    const aiMana = el('div', { class: 'slot ai-mana' }, el('h3', {}, 'Mana'), el('div', { class: 'mana' }, `${game.resources.pool(e)} / ${game.resources.available(e)}`));
    const aiLog = logPane('Enemy Log', e.log); aiLog.classList.add('ai-log');
    const aiHand = el('div', { class: 'zone ai-hand' }, el('h3', {}, 'Enemy Hand'), el('p', { class: 'count' }, `${e.hand.size()} cards`));
    const aiField = zoneCards('Enemy Battlefield', e.battlefield.cards, {}); aiField.classList.add('ai-field');

    // Player side
    const pHero = el('div', { class: 'slot p-hero' }, el('h3', {}, 'Player hero'), buildCardEl(p.hero));
    const heroEl = pHero.querySelector('.card-tooltip');
    if (heroEl && !heroEl.dataset.clickAttached) {
      heroEl.addEventListener('click', async () => { await game.attack(game.player, game.player.hero.id); onUpdate?.(); });
      heroEl.dataset.clickAttached = '1';
    }
    const pMana = el('div', { class: 'slot p-mana' }, el('h3', {}, 'Mana'), el('div', { class: 'mana' }, `${game.resources.pool(p)} / ${game.resources.available(p)}`));
    const pLog = logPane('Player Log', p.log); pLog.classList.add('p-log');
    const pField = zoneCards('Player Battlefield', p.battlefield.cards, { clickCard: async (c)=>{ await game.attack(game.player, c.id); onUpdate?.(); } }); pField.classList.add('p-field');
    const pHand = zoneCards('Player Hand', p.hand.cards, { clickCard: async (c)=>{ if (!await game.playFromHand(game.player, c.id)) { /* ignore */ } onUpdate?.(); } }); pHand.classList.add('p-hand');

    board.append(aiHero, aiMana, aiHand, aiField, aiLog, pHero, pMana, pField, pHand, pLog);
    container.append(controls, board);
  } else {
    // Keep difficulty UI in sync when not remounting
    const sel = controls.querySelector('select.select-difficulty');
    if (sel && game.state) sel.value = game.state.difficulty || 'easy';
  }

  // Update controls disabled states
  const heroPowerBtn = controls.querySelector('.btn-hero-power');
  if (heroPowerBtn) heroPowerBtn.disabled = !!(game.state?.aiThinking || game.player.hero.powerUsed || game.resources.pool(game.player) < 2 || game.player.hero.data.freezeTurns > 0);
  const endTurnBtn = controls.querySelector('.btn-end-turn');
  if (endTurnBtn) endTurnBtn.disabled = !!(game.state?.aiThinking);
  const deckBtn = controls.querySelector('.btn-deck-builder');
  if (deckBtn) deckBtn.disabled = !!(game.state?.aiThinking);
  const sel = controls.querySelector('select.select-difficulty');
  if (sel) sel.disabled = !!(game.state?.aiThinking);

  // Update mana displays
  const [aiManaEl] = board.getElementsByClassName('ai-mana');
  aiManaEl?.querySelector('.mana')?.replaceChildren(`${game.resources.pool(e)} / ${game.resources.available(e)}`);
  const [pManaEl] = board.getElementsByClassName('p-mana');
  pManaEl?.querySelector('.mana')?.replaceChildren(`${game.resources.pool(p)} / ${game.resources.available(p)}`);

  // Update hero cards
  updateCardEl(board.querySelector('.ai-hero .card-tooltip'), e.hero);
  updateCardEl(board.querySelector('.p-hero .card-tooltip'), p.hero);

  // Update zones
  syncCardsSection(board.querySelector('.ai-field'), e.battlefield.cards, {});
  syncCardsSection(board.querySelector('.p-field'), p.battlefield.cards, { clickCard: async (c)=>{ await game.attack(game.player, c.id); onUpdate?.(); } });
  syncCardsSection(board.querySelector('.p-hand'), p.hand.cards, { clickCard: async (c)=>{ if (!await game.playFromHand(game.player, c.id)) { /* ignore */ } onUpdate?.(); } });
  const aiHand = board.querySelector('.ai-hand .count');
  if (aiHand) aiHand.textContent = `${e.hand.size()} cards`;

  // Logs
  syncLogPane(board.querySelector('.ai-log'), e.log);
  syncLogPane(board.querySelector('.p-log'), p.log);

  // Keep debug checkbox in sync
  const debugEl = controls.querySelector('input.chk-debug');
  if (debugEl) {
    const on = !!(game.state?.debug);
    if (debugEl.checked !== on) debugEl.checked = on;
    // Ensure console state matches checkbox
    if (typeof window !== 'undefined') setDebugLogging(on);
  }

  // AI Thinking overlay with progress bar
  const thinking = !!(game.state?.aiThinking);
  let aiOverlay = container.querySelector('.ai-overlay');
  if (thinking) {
    const pct = Math.round(((game.state?.aiProgress ?? 0) * 100));
    if (!aiOverlay) {
      aiOverlay = el('div', { class: 'ai-overlay' },
        el('div', { class: 'panel' },
          el('p', { class: 'msg' }, 'AI is thinking...'),
          el('div', { class: 'progress' },
            el('div', { class: 'bar', style: `width: ${pct}%` })
          )
        )
      );
      container.append(aiOverlay);
    } else {
      const bar = aiOverlay.querySelector('.progress .bar');
      if (bar) bar.style.width = `${pct}%`;
    }
  } else if (aiOverlay) {
    aiOverlay.remove();
  }

  // Game over dialog
  const pDead = p.hero.data.health <= 0;
  const eDead = e.hero.data.health <= 0;
  let dialog = container.querySelector('.game-over');
  if (pDead || eDead) {
    const msg = pDead ? 'You lose!' : 'You win!';
    if (!dialog) {
      dialog = el('div', { class: 'game-over' },
        el('div', {},
          el('p', {}, msg),
          el('button', { onclick: async () => { await game.reset(); onUpdate?.(); } }, 'Restart')
        )
      );
      container.append(dialog);
    } else {
      dialog.querySelector('p').textContent = msg;
    }
  } else if (dialog) {
    dialog.remove();
  }
}
