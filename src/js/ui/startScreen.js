import { cardTooltip } from './cardTooltip.js';

const noop = () => {};

const schedule = (() => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return (cb) => window.requestAnimationFrame(cb);
  }
  return (cb) => setTimeout(cb, 16);
})();

function focusFirstChild(container) {
  if (!container) return;
  const attemptFocus = () => {
    const preferred = container.querySelector('[data-auto-focus="1"]');
    if (preferred && typeof preferred.focus === 'function') {
      preferred.focus();
      return;
    }
    const fallback = container.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (fallback && typeof fallback.focus === 'function') {
      fallback.focus();
      return;
    }
    container.focus?.();
  };
  schedule(() => attemptFocus());
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset' && value && typeof value === 'object') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value == null || value === false) continue;
    else if (key === 'disabled' || typeof value === 'boolean') node[key] = Boolean(value);
    else if (key === 'aria') {
      for (const [ariaKey, ariaValue] of Object.entries(value || {})) {
        if (ariaValue == null) continue;
        node.setAttribute(`aria-${ariaKey}`, ariaValue);
      }
    } else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function uniqueHeroesFromDecks(decks = []) {
  const list = [];
  const seen = new Set();
  for (const deck of decks) {
    const hero = deck?.hero;
    const id = hero?.id;
    if (!hero || typeof id !== 'string') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    list.push(hero);
  }
  list.sort((a, b) => {
    const nameA = typeof a?.name === 'string' ? a.name : '';
    const nameB = typeof b?.name === 'string' ? b.name : '';
    return nameA.localeCompare(nameB, undefined, { numeric: true });
  });
  return list;
}

function renderInitialStep({
  hasSavedGame,
  onContinue = noop,
  onRequestNewGame = noop,
}) {
  const buttons = [];
  if (hasSavedGame) {
    buttons.push(el('button', {
      class: 'start-screen__button',
      dataset: { autoFocus: buttons.length === 0 ? '1' : '0' },
      onclick: onContinue,
    }, 'Continue'));
  }
  const newGameButton = el('button', {
    class: 'start-screen__button start-screen__button--primary',
    dataset: { autoFocus: buttons.length === 0 ? '1' : '0' },
    onclick: onRequestNewGame,
  }, 'New Game');
  buttons.push(newGameButton);
  return el('div', {
    class: 'start-screen__panel',
    role: 'dialog',
    tabindex: '-1',
    aria: {
      modal: 'true',
      labelledby: 'start-screen-title',
      describedby: 'start-screen-subtitle',
    },
  },
    el('h2', { class: 'start-screen__title', id: 'start-screen-title' }, 'WoW Legends'),
    el('p', { class: 'start-screen__subtitle', id: 'start-screen-subtitle' }, 'Embark on a new adventure or continue your journey.'),
    el('div', { class: 'start-screen__actions' }, ...buttons),
  );
}

function renderHeroGrid({
  heroes,
  onSelect = noop,
  selectedId = null,
  heading,
  description,
  onBack = null,
  loading = false,
  headingId = 'start-screen-hero-title',
  subtitleId = 'start-screen-hero-subtitle',
}) {
  const children = [];
  if (Array.isArray(heroes) && heroes.length) {
    for (const hero of heroes) {
      const heroId = hero?.id;
      const heroName = hero?.name || 'Unknown Hero';
      const baseCard = (hero && typeof hero === 'object') ? hero : {};
      const tooltipCard = cardTooltip({
        ...baseCard,
        type: baseCard.type || 'hero',
        id: heroId || 'unknown-hero',
        name: heroName,
        text: baseCard.text || '',
      });
      tooltipCard.dataset.startScreenCard = '1';
      const ariaAttrs = { label: heroName };
      if (selectedId != null) {
        ariaAttrs.pressed = heroId && heroId === selectedId ? 'true' : 'false';
      }
      const btn = el('button', {
        class: 'start-screen__hero',
        onclick: () => onSelect(hero),
        dataset: { selected: heroId && heroId === selectedId ? '1' : '0' },
        aria: ariaAttrs,
      },
      el('span', { class: 'start-screen__hero-card' }, tooltipCard));
      children.push(btn);
    }
  } else if (loading) {
    children.push(el('p', { class: 'start-screen__empty' }, 'Loading heroes…'));
  } else {
    children.push(el('p', { class: 'start-screen__empty' }, 'No heroes available.'));
  }

  const footerButtons = [];
  if (typeof onBack === 'function') {
    footerButtons.push(el('button', { class: 'start-screen__button', onclick: onBack }, 'Back'));
  }

  const focusableButtons = children.filter((child) => child?.tagName === 'BUTTON');
  const selectedButton = focusableButtons.find((child) => child.dataset?.selected === '1');
  if (selectedButton) {
    selectedButton.dataset.autoFocus = '1';
  } else if (focusableButtons[0]) {
    focusableButtons[0].dataset.autoFocus = '1';
  }

  if (!focusableButtons.length && footerButtons[0]) {
    footerButtons[0].dataset.autoFocus = '1';
  }

  return el('div', {
    class: 'start-screen__panel',
    role: 'dialog',
    tabindex: '-1',
    aria: {
      modal: 'true',
      labelledby: headingId,
      describedby: description ? subtitleId : null,
    },
  },
    el('h2', { class: 'start-screen__title', id: headingId }, heading || 'Choose a hero'),
    description ? el('p', { class: 'start-screen__subtitle', id: subtitleId }, description) : null,
    el('div', { class: 'start-screen__hero-grid' }, ...children),
    footerButtons.length ? el('div', { class: 'start-screen__actions' }, ...footerButtons) : null,
  );
}

export function renderStartScreen(container, {
  visible = false,
  step = 'initial',
  hasSavedGame = false,
  decks = [],
  selectedHeroId = null,
  loadingDecks = false,
  onContinue = noop,
  onRequestNewGame = noop,
  onSelectHero = noop,
  onSelectOpponent = noop,
  onBack = noop,
  opponentContext = null,
} = {}) {
  if (!container) return;
  container.classList.add('start-screen');
  container.innerHTML = '';
  container.style.display = visible ? 'flex' : 'none';
  container.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) {
    container.dataset.currentStep = '';
    if (container._startScreenKeydownHandler) {
      container.removeEventListener('keydown', container._startScreenKeydownHandler);
      container._startScreenKeydownHandler = null;
    }
    return;
  }

  const keydownHandler = (event) => {
    if (event.defaultPrevented) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (step === 'opponent') {
      onBack?.('hero');
    } else if (step === 'hero') {
      onBack?.('initial');
    } else {
      onBack?.('close');
    }
  };

  if (container._startScreenKeydownHandler) {
    container.removeEventListener('keydown', container._startScreenKeydownHandler);
  }
  container._startScreenKeydownHandler = keydownHandler;
  container.addEventListener('keydown', keydownHandler);

  container.dataset.currentStep = step;

  if (step === 'initial') {
    const panel = renderInitialStep({ hasSavedGame, onContinue, onRequestNewGame });
    container.append(panel);
    focusFirstChild(panel);
    return;
  }

  const heroes = uniqueHeroesFromDecks(decks);
  if (step === 'hero') {
    const panel = renderHeroGrid({
      heroes,
      loading: loadingDecks,
      onSelect: (hero) => onSelectHero?.(hero),
      heading: 'Choose your hero',
      description: 'Select the champion you will lead into battle.',
      onBack: () => onBack?.('initial'),
      headingId: 'start-screen-hero-title',
      subtitleId: 'start-screen-hero-subtitle',
    });
    container.append(panel);
    focusFirstChild(panel);
    return;
  }

  if (step === 'opponent') {
    let subtitle = 'Select the foe you wish to challenge.';
    if (opponentContext?.playerHeroName) {
      subtitle = `Choose who will oppose ${opponentContext.playerHeroName}.`;
    }
    const panel = renderHeroGrid({
      heroes,
      loading: loadingDecks,
      selectedId: opponentContext?.selectedOpponentId || null,
      onSelect: (hero) => onSelectOpponent?.(hero),
      heading: 'Choose your opponent',
      description: subtitle,
      onBack: () => onBack?.('hero'),
      headingId: 'start-screen-opponent-title',
      subtitleId: 'start-screen-opponent-subtitle',
    });
    container.append(panel);
    focusFirstChild(panel);
  }
}

export default renderStartScreen;
