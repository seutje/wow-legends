// No HUD title import needed
import { matchesCardIdentifier } from '../utils/card.js';

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
function buildCardEl(card, { owner } = {}) {
  const tooltipCard = card.summonedBy || card;
  const wrap = el('div', { class: 'card-tooltip' });
  // Track card type for removal animations, etc.
  wrap.dataset.type = card.type;

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

  // Show the summoned unit's own name, but use summoner for art/text fallback
  const infoChildren = [
    // Show the actual card's type (e.g., 'ally' for summoned units)
    el('div', { class: 'card-type' }, card.type),
    el('h4', {}, card.name),
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
  // Allies: attack/health from data
  if (card.type === 'ally') {
    if (card.data?.attack != null) wrap.append(el('div', { class: 'stat attack' }, card.data.attack));
    if (card.data?.health != null) {
      wrap.append(el('div', { class: 'stat health' }, card.data.health));
      // Track initial health for hit animation
      wrap.dataset.prevHealth = String(card.data.health);
    }
  }
  // Hero: show current total attack and HP
  if (card.type === 'hero') {
    const heroAtk = (typeof card.totalAttack === 'function') ? card.totalAttack() : (card.data?.attack ?? 0);
    const heroHp = card.data?.health;
    if (heroAtk != null) wrap.append(el('div', { class: 'stat attack' }, heroAtk));
    if (heroHp != null) {
      wrap.append(el('div', { class: 'stat health' }, heroHp));
      // Track initial health for hit animation
      wrap.dataset.prevHealth = String(heroHp);
    }
    // Render active secrets as '?' badges near the top center
    renderSecretBadges(wrap, card);
  }
  // Equipment: show attack and durability similar to ally stats
  if (card.type === 'equipment') {
    // Find live equipped instance for current owner to reflect durability changes
    let eqAttack = card.attack;
    let eqDurability = card.durability;
    if (owner && owner.hero?.equipment) {
      const eq = owner.hero.equipment.find((e) => matchesCardIdentifier(e, card) || (card.name && e?.name === card.name));
      if (eq) { eqAttack = (eq.attack ?? eqAttack); eqDurability = (eq.durability ?? eqDurability); }
    }
    if (eqAttack != null) wrap.append(el('div', { class: 'stat attack' }, eqAttack));
    if (eqDurability != null) wrap.append(el('div', { class: 'stat health' }, eqDurability));
    // Track durability for future change detection
    if (typeof eqDurability === 'number') wrap.dataset.prevDurability = String(eqDurability);
  }

  art.src = `src/assets/optim/${tooltipCard.id}-art.png`;
  // Apply initial status indicators (divine shield, frozen, windfury, stealth)
  applyStatusIndicators(wrap, card);
  return wrap;
}

const ATTACK_LAYER_ID = 'attack-anim-layer';
const ATTACK_ANIM_FLAG = Symbol('attackAnimBound');
const ATTACK_ANIM_DURATION_MS = 480;

const requestFrame = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
  ? window.requestAnimationFrame.bind(window)
  : (cb) => setTimeout(() => cb(Date.now()), 16);

function escapeAttrValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (typeof window !== 'undefined' && window.CSS?.escape) return window.CSS.escape(str);
  return str.replace(/["\\]/g, '\\$&');
}

const FULLSCREEN_EVENT_NAMES = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
let fullscreenButtonRef = null;
let fullscreenChangeHandler = null;

function getFullscreenDocument() {
  if (typeof document === 'undefined') return null;
  return document;
}

function getFullscreenElement() {
  const doc = getFullscreenDocument();
  if (!doc) return null;
  return doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement || null;
}

function getFullscreenTarget() {
  const doc = getFullscreenDocument();
  if (!doc) return null;
  return doc.documentElement || doc.body || null;
}

function getRequestFullscreenFn(target) {
  if (!target) return null;
  return target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen || null;
}

function getExitFullscreenFn(doc) {
  if (!doc) return null;
  return doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen || null;
}

function isFullscreenSupported() {
  const target = getFullscreenTarget();
  return !!target && !!getRequestFullscreenFn(target);
}

function isFullscreenActive() {
  return !!getFullscreenElement();
}

function updateFullscreenButton(button) {
  if (!button) return;
  const supported = isFullscreenSupported();
  button.disabled = !supported;
  if (supported) button.removeAttribute('title');
  else button.setAttribute('title', 'Fullscreen is not supported in this browser.');
  const active = isFullscreenActive();
  button.textContent = active ? 'Exit Fullscreen' : 'Fullscreen';
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function ensureFullscreenButtonTracking(button) {
  if (!button) return;
  const doc = getFullscreenDocument();
  if (!doc) return;
  fullscreenButtonRef = button;
  updateFullscreenButton(button);
  if (!fullscreenChangeHandler) {
    fullscreenChangeHandler = () => {
      if (fullscreenButtonRef?.isConnected) updateFullscreenButton(fullscreenButtonRef);
    };
    for (const evt of FULLSCREEN_EVENT_NAMES) {
      doc.addEventListener(evt, fullscreenChangeHandler);
    }
  }
}

async function toggleFullscreen(button) {
  const doc = getFullscreenDocument();
  if (!doc) return;
  const active = isFullscreenActive();
  try {
    if (active) {
      const exitFn = getExitFullscreenFn(doc);
      if (exitFn) {
        const result = exitFn.call(doc);
        if (result && typeof result.then === 'function') await result;
      }
    } else {
      const target = getFullscreenTarget();
      const requestFn = getRequestFullscreenFn(target);
      if (target && requestFn) {
        const result = requestFn.call(target);
        if (result && typeof result.then === 'function') await result;
      }
    }
  } catch {
    /* ignore fullscreen toggle errors */
  } finally {
    if (button) updateFullscreenButton(button);
  }
}

function resolveDomCardKey(card) {
  if (!card) return null;
  if (card.instanceId != null) return String(card.instanceId);
  if (card.id != null) return String(card.id);
  return null;
}

function findCardNodeByKey(key) {
  if (!key || typeof document === 'undefined') return null;
  const escaped = escapeAttrValue(key);
  return document.querySelector(`.board [data-card-id="${escaped}"]`);
}

function ensureAttackLayer() {
  if (typeof document === 'undefined') return null;
  let layer = document.getElementById(ATTACK_LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = ATTACK_LAYER_ID;
    layer.className = 'attack-animation-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

function animateAttackFlight(attacker, defender) {
  if (typeof document === 'undefined') return;
  if (!attacker || !(attacker.type === 'ally' || attacker.type === 'hero')) return;

  const attackerKey = resolveDomCardKey(attacker);
  if (!attackerKey) return;
  const attackerNode = findCardNodeByKey(attackerKey);
  if (!attackerNode) return;

  const attackerRect = attackerNode.getBoundingClientRect();
  if (!attackerRect?.width || !attackerRect?.height) return;

  const layer = ensureAttackLayer();
  if (!layer) return;

  const clone = attackerNode.cloneNode(true);
  clone.classList.add('attack-flyer');
  const cloneStyle = clone.style;
  cloneStyle.position = 'fixed';
  cloneStyle.left = `${attackerRect.left}px`;
  cloneStyle.top = `${attackerRect.top}px`;
  cloneStyle.width = `${attackerRect.width}px`;
  cloneStyle.height = `${attackerRect.height}px`;
  cloneStyle.transform = 'translate3d(0, 0, 0)';
  cloneStyle.pointerEvents = 'none';
  cloneStyle.willChange = 'transform';
  layer.append(clone);

  const targetKey = resolveDomCardKey(defender);
  const targetNode = targetKey ? findCardNodeByKey(targetKey) : null;
  const targetRect = targetNode?.getBoundingClientRect();

  const startX = attackerRect.left + attackerRect.width / 2;
  const startY = attackerRect.top + attackerRect.height / 2;
  let dx = 0;
  let dy = 0;
  if (targetRect) {
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    dx = endX - startX;
    dy = endY - startY;
  } else if (typeof window !== 'undefined') {
    dy = (startY < window.innerHeight / 2) ? -80 : 80;
  }

  const useWAAPI = typeof clone.animate === 'function';
  if (useWAAPI) {
    const impactFrames = [
      { transform: 'translate3d(0, 0, 0) scale(1)', offset: 0 },
      { transform: `translate3d(${dx * 0.82}px, ${dy * 0.82}px, 0) scale(1.05)`, offset: 0.55 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.96)`, offset: 0.7 },
      { transform: `translate3d(${dx * 0.6}px, ${dy * 0.6}px, 0) scale(1.02)`, offset: 0.86 },
      { transform: 'translate3d(0, 0, 0) scale(1)', offset: 1 },
    ];
    const anim = clone.animate(impactFrames, { duration: ATTACK_ANIM_DURATION_MS, easing: 'ease-in-out' });
    const cleanup = () => { clone.remove(); };
    anim.addEventListener('finish', cleanup, { once: true });
    anim.addEventListener('cancel', cleanup, { once: true });
  } else {
    cloneStyle.transition = `transform ${Math.floor(ATTACK_ANIM_DURATION_MS * 0.6)}ms ease-in-out`;
    requestFrame(() => {
      cloneStyle.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      setTimeout(() => {
        cloneStyle.transition = `transform ${Math.floor(ATTACK_ANIM_DURATION_MS * 0.4)}ms ease-in-out`;
        cloneStyle.transform = 'translate3d(0, 0, 0)';
      }, Math.floor(ATTACK_ANIM_DURATION_MS * 0.6));
    });
  }

  setTimeout(() => { clone.remove(); }, ATTACK_ANIM_DURATION_MS + 180);

  if (targetNode) {
    targetNode.classList.add('attack-bump');
    setTimeout(() => { targetNode.classList.remove('attack-bump'); }, 320);
  }
}

function ensureAttackAnimationSubscription(game) {
  if (!game || !game.bus || typeof document === 'undefined') return;
  if (game[ATTACK_ANIM_FLAG]) return;
  const handler = ({ attacker, defender }) => {
    if (!attacker || !(attacker.type === 'ally' || attacker.type === 'hero')) return;
    requestFrame(() => { animateAttackFlight(attacker, defender); });
  };
  game.bus.on('attackCommitted', handler);
  game[ATTACK_ANIM_FLAG] = true;
}

function zoneCards(title, cards, { clickCard, owner } = {}) {
  const wrap = el('div', { class: 'cards' });
  const counts = new Map();
  for (const c of cards) {
    const baseKey = c.instanceId || c.id || 'card';
    const n = (counts.get(baseKey) || 0) + 1; counts.set(baseKey, n);
    const key = c.instanceId || `${baseKey}#${n}`;
    const cardEl = buildCardEl(c, { owner });
    const instanceId = c.instanceId || c.id;
    if (instanceId != null) cardEl.dataset.cardId = String(instanceId);
    if (c.id != null) cardEl.dataset.templateId = String(c.id);
    cardEl.dataset.key = key;
    if (clickCard) cardEl.addEventListener('click', async () => { await clickCard(c); });
    wrap.append(cardEl);
  }
  const sectionChildren = [];
  if (title != null && title !== '') sectionChildren.push(el('h3', {}, title));
  sectionChildren.push(wrap);
  return el('section', { class: 'zone' }, ...sectionChildren);
}

function handSize(hand) {
  if (typeof hand?.size === 'function') return hand.size();
  if (Array.isArray(hand?.cards)) return hand.cards.length;
  return 0;
}

function buildAiHandZone(hand, { owner, debugOn } = {}) {
  if (!debugOn) return null;
  const section = zoneCards('Enemy Hand', hand?.cards ?? [], { owner });
  section.classList.add('ai-hand');
  section.dataset.debugView = '1';
  return section;
}

function buildAiHandIndicator(hand) {
  return el('p', { class: 'ai-hand-count' }, `${handSize(hand)} cards`);
}

function logPane(title, entries = []) {
  const ul = el('ul', {}, ...entries.map(e => el('li', {}, e)));
  const pane = el('div', { class: 'log-pane zone' }, el('h3', {}, title), ul);
  // Ensure the latest entries are visible
  setTimeout(() => { ul.scrollTop = ul.scrollHeight; });
  return pane;
}

function updateCardEl(cardEl, card, { owner } = {}) {
  if (!cardEl) return;
  const tooltipCard = card.summonedBy || card;
  const instanceId = card.instanceId || card.id;
  if (instanceId != null) cardEl.dataset.cardId = String(instanceId);
  if (card.id != null) cardEl.dataset.templateId = String(card.id);
  // Keep dataset type in sync for this node
  cardEl.dataset.type = card.type;
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
  if (typeEl) typeEl.textContent = card.type;
  const nameEl = cardEl.querySelector('h4');
  if (nameEl) nameEl.textContent = card.name;
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
  const hpEl = cardEl.querySelector('.stat.health');
  if (card.type === 'ally') {
    if (atkEl && card.data?.attack != null) atkEl.textContent = String(card.data.attack);
    if (hpEl && card.data?.health != null) hpEl.textContent = String(card.data.health);
    // Shake animation when health decreased
    const prev = Number(cardEl.dataset.prevHealth);
    const newHp = (typeof card?.data?.health === 'number') ? card.data.health : NaN;
    if (!Number.isNaN(prev) && !Number.isNaN(newHp) && newHp < prev) {
      cardEl.classList.add('shake-hit');
      setTimeout(() => { cardEl.classList.remove('shake-hit'); }, 400);
    }
    if (!Number.isNaN(newHp)) cardEl.dataset.prevHealth = String(newHp);
  }
  if (card.type === 'hero') {
    const heroAtk = (typeof card.totalAttack === 'function') ? card.totalAttack() : (card.data?.attack ?? 0);
    const heroHp = card.data?.health;
    if (atkEl) atkEl.textContent = String(heroAtk ?? '');
    else if (heroAtk != null) cardEl.append(el('div', { class: 'stat attack' }, String(heroAtk)));
    if (hpEl) hpEl.textContent = String(heroHp ?? '');
    else if (heroHp != null) cardEl.append(el('div', { class: 'stat health' }, String(heroHp)));
    // Shake animation when hero health decreased
    const prev = Number(cardEl.dataset.prevHealth);
    const newHp = (typeof heroHp === 'number') ? heroHp : NaN;
    if (!Number.isNaN(prev) && !Number.isNaN(newHp) && newHp < prev) {
      cardEl.classList.add('shake-hit');
      setTimeout(() => { cardEl.classList.remove('shake-hit'); }, 400);
    }
    if (!Number.isNaN(newHp)) cardEl.dataset.prevHealth = String(newHp);
    // Keep secret badges in sync
    renderSecretBadges(cardEl, card);
  }
  if (card.type === 'equipment') {
    let eqAttack = card.attack;
    let eqDurability = card.durability;
    if (owner && owner.hero?.equipment) {
      const eq = owner.hero.equipment.find(e => e?.id === card.id || e?.name === card.name);
      if (eq) { eqAttack = (eq.attack ?? eqAttack); eqDurability = (eq.durability ?? eqDurability); }
    }
    if (atkEl && eqAttack != null) atkEl.textContent = String(eqAttack);
    if (hpEl && eqDurability != null) hpEl.textContent = String(eqDurability);
    // If missing nodes (e.g., newly became equipment), add them
    if (!atkEl && eqAttack != null) cardEl.append(el('div', { class: 'stat attack' }, String(eqAttack)));
    if (!hpEl && eqDurability != null) cardEl.append(el('div', { class: 'stat health' }, String(eqDurability)));

    // Shake animation when durability decreased
    const prev = Number(cardEl.dataset.prevDurability);
    if (!Number.isNaN(prev) && typeof eqDurability === 'number' && eqDurability < prev) {
      cardEl.classList.add('shake-hit');
      setTimeout(() => { cardEl.classList.remove('shake-hit'); }, 400);
    }
  if (typeof eqDurability === 'number') cardEl.dataset.prevDurability = String(eqDurability);
  }

  // Refresh status indicators (divine shield, frozen, windfury, stealth)
  applyStatusIndicators(cardEl, card);
}

function syncCardsSection(sectionEl, cards, { clickCard, owner } = {}) {
  if (!sectionEl) return;
  const list = sectionEl.querySelector('.cards') || sectionEl;
  const cardArray = Array.isArray(cards) ? cards : (cards ? Array.from(cards) : []);
  const byKey = new Map(Array.from(list.children).map(node => [node.dataset.key, node]));
  const isPlayerHand = sectionEl.classList?.contains('p-hand');
  if (sectionEl.dataset) sectionEl.dataset.cardCount = String(cardArray.length);
  if (isPlayerHand) {
    const initialOverlap = cardArray.length > 1 ? Math.min(120, 32 + cardArray.length * 9) : 0;
    sectionEl.style.setProperty('--hand-overlap', `${initialOverlap}px`);
  } else if (sectionEl.style) {
    sectionEl.style.removeProperty('--hand-overlap');
  }
  const seen = new Set();
  // Rebuild order with minimal moves; disambiguate duplicates by occurrence index
  const counts = new Map();
  let lastNode = null;
  for (const c of cardArray) {
    const baseKey = c.instanceId || c.id || 'card';
    const n = (counts.get(baseKey) || 0) + 1; counts.set(baseKey, n);
    const key = c.instanceId || `${baseKey}#${n}`;
    seen.add(key);
    let node = byKey.get(key);
    if (!node) {
      node = buildCardEl(c, { owner });
      const instanceId = c.instanceId || c.id;
      if (instanceId != null) node.dataset.cardId = String(instanceId);
      if (c.id != null) node.dataset.templateId = String(c.id);
      node.dataset.key = key;
      if (clickCard && !node.dataset.clickAttached) {
        node.addEventListener('click', async () => { await clickCard(c); });
        node.dataset.clickAttached = '1';
      }
    } else {
      updateCardEl(node, c, { owner });
      byKey.delete(key);
      node.dataset.key = key;
    }
    if (lastNode) {
      if (node.previousSibling !== lastNode) list.insertBefore(node, lastNode.nextSibling);
    } else if (node !== list.firstChild) {
      list.insertBefore(node, list.firstChild);
    }
    lastNode = node;
  }
  // Remove any remaining nodes (cards no longer present)
  const isBattlefield = sectionEl.classList?.contains('ai-field') || sectionEl.classList?.contains('p-field');
  for (const [k, node] of byKey) {
    if (seen.has(k)) continue;
    // If this is a battlefield ally, fade out before removing
    if (isBattlefield && node?.dataset?.type === 'ally') {
      if (node.dataset.removing === '1') continue; // already animating out
      node.dataset.removing = '1';
      node.classList.add('fade-out');
      setTimeout(() => { node.remove(); }, 400);
    } else {
      node.remove();
    }
  }

  if (sectionEl.dataset) sectionEl.dataset.cardCount = String(list.children.length);
  if (isPlayerHand) {
    const cardEls = Array.from(list.children);
    const count = cardEls.length;
    const overlap = count > 1 ? Math.min(120, 32 + count * 9) : 0;
    sectionEl.style.setProperty('--hand-overlap', `${overlap}px`);
    const maxAngle = 16;
    const angleStep = count > 1 ? (maxAngle * 2) / (count - 1) : 0;
    const center = (count - 1) / 2;
    cardEls.forEach((node, index) => {
      const offset = index - center;
      const angle = count > 1 ? offset * angleStep : 0;
      const depth = Math.abs(offset);
      const translate = count > 1 ? Math.pow(depth, 1.2) * 3.6 : 0;
      node.style.setProperty('--fan-rotate', `${angle.toFixed(2)}deg`);
      node.style.setProperty('--fan-translate', `${translate.toFixed(2)}`);
      node.style.setProperty('--fan-z', `${100 + index}`);
    });
  } else if (list.children?.length) {
    for (const node of list.children) {
      node.style.removeProperty('--fan-rotate');
      node.style.removeProperty('--fan-translate');
      node.style.removeProperty('--fan-z');
    }
  }
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

// --- Status indicators ---
function ensureOverlay(cardEl, cls) {
  let ov = cardEl.querySelector(`.status-overlay.${cls}`);
  if (!ov) {
    ov = el('div', { class: `status-overlay ${cls}` });
    cardEl.append(ov);
  }
  return ov;
}

function removeOverlay(cardEl, cls) {
  const ov = cardEl.querySelector(`.status-overlay.${cls}`);
  if (ov) ov.remove();
}

function applyStatusIndicators(cardEl, card) {
  // Stealth: dim the entire card
  const hasStealth = !!(card?.keywords?.includes?.('Stealth'));
  if (hasStealth) cardEl.classList.add('status-stealthed');
  else cardEl.classList.remove('status-stealthed');

  // Divine Shield: boolean on data
  const hasShield = !!(card?.data?.divineShield);
  if (hasShield) ensureOverlay(cardEl, 'status-divine-shield');
  else removeOverlay(cardEl, 'status-divine-shield');

  // Frozen: freezeTurns > 0
  const isFrozen = ((card?.data?.freezeTurns || 0) > 0);
  if (isFrozen) ensureOverlay(cardEl, 'status-frozen');
  else removeOverlay(cardEl, 'status-frozen');

  // Windfury: keyword presence
  const hasWindfury = !!(card?.keywords?.includes?.('Windfury'));
  if (hasWindfury) ensureOverlay(cardEl, 'status-windfury');
  else removeOverlay(cardEl, 'status-windfury');
}

// --- Secrets indicator ---
function renderSecretBadges(cardEl, card) {
  // Remove existing secret badges
  for (const node of Array.from(cardEl.querySelectorAll('.stat.secret'))) node.remove();
  if (!card || card.type !== 'hero') return;
  const count = Array.isArray(card?.data?.secrets) ? card.data.secrets.length : 0;
  if (!count) return;
  const spacing = 18; // px between badges when fanned
  const start = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const off = start + i * spacing;
    const style = `top: 3%; left: calc(50% + ${off}px);`;
    cardEl.append(el('div', { class: 'stat secret', style }, '?'));
  }
}

import { setDebugLogging } from '../utils/logger.js';
import { loadSettings, rehydrateDeck } from '../utils/settings.js';

import { saveDifficulty } from '../utils/settings.js';

export function renderPlay(container, game, { onUpdate, onOpenDeckBuilder, onNewGame } = {}) {
  const p = game.player; const e = game.opponent;
  const debugEnabled = !!(game.state?.debug);
  const defaultDifficulty = game?._defaultDifficulty || 'nightmare';

  ensureAttackAnimationSubscription(game);

  let headerEl = document.querySelector('header');
  if (!headerEl) {
    headerEl = el('header', { 'aria-label': 'App Header' }, el('strong', {}, 'WoW Legends'));
    document.body.prepend(headerEl);
  }

  let controls = headerEl.querySelector('.controls');
  let board = container.querySelector('.board');

  const initialControlsMount = !controls;
  const initialBoardMount = !board;

  if (initialControlsMount) {
    const diffOptions = ['easy', 'medium', 'hard', 'nightmare', 'hybrid'];
    const currentDifficulty = game.state?.difficulty || defaultDifficulty;
    const diffSelect = el('select', {
      class: 'select-difficulty',
      onchange: (e) => {
        const v = e.target.value;
        if (game.state) game.state.difficulty = v;
        if (v === 'nightmare' || v === 'hybrid') {
          game.preloadNeuralModel?.();
        }
        try { saveDifficulty(v); } catch {}
        onUpdate?.();
      }
    }, ...diffOptions.map(opt => el('option', { value: opt, selected: currentDifficulty === opt }, opt.charAt(0).toUpperCase() + opt.slice(1))));
    diffSelect.value = currentDifficulty;

    const debugChk = el('input', { type: 'checkbox', class: 'chk-debug', onchange: (e) => {
      const on = !!e.target.checked;
      if (game.state) game.state.debug = on;
      setDebugLogging(on);
      onUpdate?.();
    } });
    debugChk.checked = !!(game.state?.debug);

    let fullscreenBtn;
    fullscreenBtn = el('button', {
      class: 'btn-fullscreen',
      type: 'button',
      onclick: async () => { await toggleFullscreen(fullscreenBtn); }
    }, 'Fullscreen');
    ensureFullscreenButtonTracking(fullscreenBtn);

    controls = el('div', { class: 'controls' },
      el('button', { class: 'btn-new-game', onclick: async (ev) => {
        const btn = ev?.currentTarget;
        if (btn) btn.disabled = true;
        try {
          if (onNewGame) await onNewGame();
        } finally {
          if (btn) btn.disabled = false;
          onUpdate?.();
        }
      } }, 'New Game'),
      el('button', { class: 'btn-deck-builder', onclick: () => { onOpenDeckBuilder?.(); } }, 'Deck Builder'),
      el('button', { class: 'btn-hero-power', onclick: async () => { await game.useHeroPower(game.player); onUpdate?.(); } }, 'Hero Power'),
      el('button', { class: 'btn-end-turn', onclick: async (ev) => {
        const btn = ev?.currentTarget;
        if (btn) btn.disabled = true;
        if (game?.state) {
          game.state.aiThinking = true;
          game.state.aiProgress = 0;
        }
        onUpdate?.();
        try {
          await game.endTurn();
        } finally {
          if (game?.state) game.state.aiThinking = false;
          if (btn) btn.disabled = false;
          onUpdate?.();
        }
      } }, 'End Turn'),
      el('button', { class: 'btn-autoplay', onclick: async (ev) => {
        const btn = ev?.currentTarget;
        if (btn) btn.disabled = true;
        try {
          await game.autoplayTurn();
        } finally {
          if (btn) btn.disabled = false;
          onUpdate?.();
        }
      } }, 'Autoplay'),
      el('label', { class: 'lbl-difficulty' }, 'Difficulty: ', diffSelect),
      fullscreenBtn,
      el('label', { class: 'lbl-debug' }, debugChk, ' Debug logs')
    );
    headerEl.append(controls);
  }

  if (initialBoardMount) {
    container.innerHTML = '';
    board = el('div', { class: 'board' });

    // AI side
    const aiHero = el(
      'div',
      { class: 'slot ai-hero' },
      el('h3', {}, 'AI hero'),
      el('div', { class: 'hero-mana' }, `${game.resources.pool(e)}/${game.resources.available(e)} Mana`),
      buildCardEl(e.hero),
      buildAiHandIndicator(e.hand)
    );
    const aiLog = logPane('Enemy Log', e.log); aiLog.classList.add('ai-log');
    const aiHand = buildAiHandZone(e.hand, { owner: e, debugOn: debugEnabled });
    const aiField = zoneCards('Enemy Battlefield', e.battlefield.cards, { owner: e }); aiField.classList.add('ai-field');

    // Player side
    const pHero = el(
      'div',
      { class: 'slot p-hero' },
      el('h3', {}, 'Player hero'),
      el('div', { class: 'hero-mana' }, `${game.resources.pool(p)}/${game.resources.available(p)} Mana`),
      buildCardEl(p.hero)
    );
    const heroEl = pHero.querySelector('.card-tooltip');
    if (heroEl && !heroEl.dataset.clickAttached) {
      heroEl.addEventListener('click', async () => { await game.attack(game.player, game.player.hero); onUpdate?.(); });
      heroEl.dataset.clickAttached = '1';
    }
    const pLog = logPane('Player Log', p.log); pLog.classList.add('p-log');
    const pField = zoneCards('Player Battlefield', p.battlefield.cards, { owner: p, clickCard: async (c)=>{ await game.attack(game.player, c); onUpdate?.(); } }); pField.classList.add('p-field');
    const pHand = zoneCards(null, p.hand.cards, { owner: p, clickCard: async (c)=>{ if (!await game.playFromHand(game.player, c)) { /* ignore */ } onUpdate?.(); } }); pHand.classList.add('p-hand');
    board.append(aiHero);
    if (aiHand) board.append(aiHand);
    board.append(aiField, aiLog, pHero, pField, pHand, pLog);
    container.append(board);
  }

  if (!initialControlsMount) {
    const sel = controls.querySelector('select.select-difficulty');
    if (sel && game.state) sel.value = game.state.difficulty || defaultDifficulty;
    const fullscreenBtn = controls.querySelector('.btn-fullscreen');
    if (fullscreenBtn) ensureFullscreenButtonTracking(fullscreenBtn);
  }

  // Update controls disabled states
  const isPlayerTurn = game.turns?.activePlayer === game.player;
  const heroPowerBtn = controls.querySelector('.btn-hero-power');
  if (heroPowerBtn) heroPowerBtn.disabled = !!(game.state?.aiThinking || game.player.hero.powerUsed || game.resources.pool(game.player) < 2 || game.player.hero.data.freezeTurns > 0);
  const endTurnBtn = controls.querySelector('.btn-end-turn');
  if (endTurnBtn) endTurnBtn.disabled = !!(game.state?.aiThinking);
  const autoplayBtn = controls.querySelector('.btn-autoplay');
  if (autoplayBtn) autoplayBtn.disabled = !!(game.state?.aiThinking || !isPlayerTurn);
  const newGameBtn = controls.querySelector('.btn-new-game');
  if (newGameBtn) newGameBtn.disabled = !!(game.state?.aiThinking);
  const deckBtn = controls.querySelector('.btn-deck-builder');
  if (deckBtn) deckBtn.disabled = !!(game.state?.aiThinking);
  const sel = controls.querySelector('select.select-difficulty');
  if (sel) sel.disabled = !!(game.state?.aiThinking);

  // Update mana displays
  const aiManaEl = board.querySelector('.ai-hero .hero-mana');
  aiManaEl?.replaceChildren(`${game.resources.pool(e)}/${game.resources.available(e)} Mana`);
  const playerManaEl = board.querySelector('.p-hero .hero-mana');
  playerManaEl?.replaceChildren(`${game.resources.pool(p)}/${game.resources.available(p)} Mana`);

  // Update hero cards
  updateCardEl(board.querySelector('.ai-hero .card-tooltip'), e.hero);
  updateCardEl(board.querySelector('.p-hero .card-tooltip'), p.hero);
  const aiHandCountEl = board.querySelector('.ai-hero .ai-hand-count');
  aiHandCountEl?.replaceChildren(`${handSize(e.hand)} cards`);

  // Update zones
  syncCardsSection(board.querySelector('.ai-field'), e.battlefield.cards, { owner: e });
  syncCardsSection(board.querySelector('.p-field'), p.battlefield.cards, { owner: p, clickCard: async (c)=>{ await game.attack(game.player, c); onUpdate?.(); } });
  syncCardsSection(board.querySelector('.p-hand'), p.hand.cards, { owner: p, clickCard: async (c)=>{ if (!await game.playFromHand(game.player, c)) { /* ignore */ } onUpdate?.(); } });
  let aiHandSection = board.querySelector('.ai-hand');
  if (debugEnabled) {
    if (!aiHandSection || aiHandSection.dataset?.debugView !== '1') {
      const replacement = buildAiHandZone(e.hand, { owner: e, debugOn: true });
      if (aiHandSection) {
        aiHandSection.replaceWith(replacement);
      } else {
        const aiFieldEl = board.querySelector('.ai-field');
        if (aiFieldEl?.parentNode) aiFieldEl.parentNode.insertBefore(replacement, aiFieldEl);
        else board.append(replacement);
      }
      aiHandSection = replacement;
    }
    if (aiHandSection) syncCardsSection(aiHandSection, e.hand.cards, { owner: e });
  } else if (aiHandSection) {
    aiHandSection.remove();
  }

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
    const progress = Math.max(0, Math.min(1, game.state?.aiProgress ?? 0));
    const progressStr = progress.toFixed(4);
    if (!aiOverlay) {
      aiOverlay = el('div', { class: 'ai-overlay' },
        el('div', { class: 'panel' },
          el('p', { class: 'msg' }, 'AI is thinking...'),
          el('div', {
            class: 'progress',
            style: `--progress-pos: ${progressStr}`,
            dataset: { complete: progress >= 0.999 ? '1' : '0' },
          })
        )
      );
      container.append(aiOverlay);
    } else {
      const progressEl = aiOverlay.querySelector('.progress');
      if (progressEl) {
        progressEl.style.setProperty('--progress-pos', progressStr);
        progressEl.dataset.complete = progress >= 0.999 ? '1' : '0';
      }
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
          el('button', { onclick: async () => {
            // Prefer saved deck on restart; fall back to random
            let deck = null;
            try {
              const settings = loadSettings();
              if (settings?.lastDeck) deck = rehydrateDeck(settings.lastDeck, game.allCards);
            } catch {}
            await game.reset(deck || null);
            onUpdate?.();
          } }, 'Restart')
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
