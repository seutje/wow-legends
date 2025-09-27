import { cardTooltip } from './cardTooltip.js';

function sortHeroes(heroes = []) {
  return heroes
    .filter((hero) => hero && hero.type === 'hero')
    .sort((a, b) => {
      const aLabel = a?.name ? String(a.name) : String(a?.id ?? '');
      const bLabel = b?.name ? String(b.name) : String(b?.id ?? '');
      return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base', numeric: true });
    });
}

export function setupStartScreen(parentNode, {
  getHeroes = () => [],
  hasSavedGame = () => false,
  onContinue = null,
  onHeroSelectionStart = null,
  onStartNewGame = null,
  onCancel = null,
} = {}) {
  const host = parentNode || document.body || document.documentElement;
  const overlay = document.createElement('div');
  overlay.className = 'start-screen-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  host.appendChild(overlay);

  const state = {
    step: 'intro',
    playerHero: null,
    fromIntro: false,
  };

  const callHeroSelectionStart = () => {
    if (typeof onHeroSelectionStart === 'function') {
      onHeroSelectionStart();
    }
  };

  const hide = () => {
    overlay.hidden = true;
    overlay.innerHTML = '';
  };

  const showIntro = () => {
    state.step = 'intro';
    state.playerHero = null;
    state.fromIntro = true;
    render();
  };

  const showHeroSelect = (fromIntro = false) => {
    state.step = 'player';
    state.playerHero = null;
    state.fromIntro = !!fromIntro;
    callHeroSelectionStart();
    render();
  };

  const showOpponentSelect = () => {
    if (!state.playerHero) {
      showHeroSelect(state.fromIntro);
      return;
    }
    state.step = 'opponent';
    render();
  };

  const renderIntro = (panel) => {
    const title = document.createElement('h2');
    title.textContent = 'Welcome to WoW Legends';
    panel.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent = 'Choose an option to get started.';
    panel.appendChild(desc);

    const buttons = document.createElement('div');
    buttons.className = 'start-screen-buttons';

    const newGameBtn = document.createElement('button');
    newGameBtn.className = 'start-screen-button';
    newGameBtn.type = 'button';
    newGameBtn.textContent = 'New Game';
    newGameBtn.addEventListener('click', () => {
      showHeroSelect(true);
    });
    buttons.appendChild(newGameBtn);

    if (typeof onContinue === 'function' && hasSavedGame()) {
      const continueBtn = document.createElement('button');
      continueBtn.className = 'start-screen-button secondary';
      continueBtn.type = 'button';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', async () => {
        if (continueBtn.disabled) return;
        continueBtn.disabled = true;
        try {
          await onContinue();
        } finally {
          continueBtn.disabled = false;
        }
      });
      buttons.appendChild(continueBtn);
    }

    panel.appendChild(buttons);
  };

  const renderHeroSelect = (panel) => {
    const title = document.createElement('h2');
    title.textContent = 'Select your hero';
    panel.appendChild(title);

    const heroes = sortHeroes(getHeroes());
    if (!heroes.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No heroes available.';
      panel.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'start-screen-grid';
      for (const hero of heroes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'start-screen-hero';
        btn.dataset.heroId = hero?.id ? String(hero.id) : '';
        const cardEl = cardTooltip(hero);
        if (cardEl) {
          cardEl.classList.add('start-screen-card');
          cardEl.setAttribute('aria-hidden', 'true');
          btn.appendChild(cardEl);
        }
        const name = document.createElement('span');
        name.className = 'start-screen-hero-name';
        name.textContent = hero?.name ? String(hero.name) : 'Unknown hero';
        btn.appendChild(name);
        btn.addEventListener('click', () => {
          state.playerHero = hero;
          showOpponentSelect();
        });
        grid.appendChild(btn);
      }
      panel.appendChild(grid);
    }

    const buttons = document.createElement('div');
    buttons.className = 'start-screen-buttons';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'start-screen-button secondary';
    backBtn.textContent = state.fromIntro ? 'Back' : 'Cancel';
    backBtn.addEventListener('click', () => {
      if (state.fromIntro) {
        showIntro();
      } else {
        hide();
        if (typeof onCancel === 'function') onCancel();
      }
    });
    buttons.appendChild(backBtn);
    panel.appendChild(buttons);
  };

  const renderOpponentSelect = (panel) => {
    const title = document.createElement('h2');
    title.textContent = 'Select your opponent';
    panel.appendChild(title);

    const summary = document.createElement('p');
    summary.textContent = state.playerHero?.name
      ? `You will play as ${state.playerHero.name}. Choose who you want to battle.`
      : 'Choose who you want to battle.';
    panel.appendChild(summary);

    const heroes = sortHeroes(getHeroes());
    if (!heroes.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No opponent heroes available.';
      panel.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'start-screen-grid';
      for (const hero of heroes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'start-screen-hero';
        btn.dataset.heroId = hero?.id ? String(hero.id) : '';
        if (state.playerHero && hero?.id === state.playerHero.id) {
          btn.dataset.selected = '1';
        }
        const cardEl = cardTooltip(hero);
        if (cardEl) {
          cardEl.classList.add('start-screen-card');
          cardEl.setAttribute('aria-hidden', 'true');
          btn.appendChild(cardEl);
        }
        const name = document.createElement('span');
        name.className = 'start-screen-hero-name';
        name.textContent = hero?.name ? String(hero.name) : 'Unknown hero';
        btn.appendChild(name);
        btn.addEventListener('click', async () => {
          if (!state.playerHero) return;
          if (overlay.dataset.busy === '1') return;
          overlay.dataset.busy = '1';
          try {
            if (typeof onStartNewGame === 'function') {
              await onStartNewGame({ playerHero: state.playerHero, opponentHero: hero });
            }
          } finally {
            delete overlay.dataset.busy;
          }
        });
        grid.appendChild(btn);
      }
      panel.appendChild(grid);
    }

    const buttons = document.createElement('div');
    buttons.className = 'start-screen-buttons';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'start-screen-button secondary';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      showHeroSelect(state.fromIntro);
    });
    buttons.appendChild(backBtn);
    panel.appendChild(buttons);
  };

  const render = () => {
    overlay.hidden = false;
    overlay.innerHTML = '';
    overlay.dataset.step = state.step;
    const panel = document.createElement('div');
    panel.className = 'start-screen-panel';
    overlay.appendChild(panel);

    switch (state.step) {
      case 'player':
        renderHeroSelect(panel);
        break;
      case 'opponent':
        renderOpponentSelect(panel);
        break;
      case 'intro':
      default:
        renderIntro(panel);
        break;
    }
  };

  return {
    showIntro,
    showHeroSelect,
    showOpponentSelect,
    hide,
    isVisible: () => !overlay.hidden,
    get state() {
      return { ...state };
    },
  };
}

export default setupStartScreen;
