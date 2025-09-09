// Orchestrates core game lifecycle and a minimal playable engine.
import Player from './entities/player.js';
import Card from './entities/card.js';
import TurnSystem from './systems/turns.js';
import ResourceSystem from './systems/resources.js';
import CombatSystem from './systems/combat.js';
import EffectSystem from './systems/effects.js';
import { validateCardData } from './systems/content.js';
import { RNG } from './utils/rng.js';
import Hero from './entities/hero.js';
import { renderBoard } from './ui/board.js';
import QuestSystem from './systems/quests.js';
import { EventBus } from './utils/events.js';

export default class Game {
  constructor(rootEl, opts = {}) {
    this.rootEl = rootEl;
    this.opts = opts;
    this.running = false;
    this._raf = 0;
    this._lastTs = 0;

    // Systems
    this.turns = new TurnSystem();
    this.resources = new ResourceSystem(this.turns);
    this.combat = new CombatSystem();
    this.effects = new EffectSystem(this);
    this.rng = new RNG();
    this.bus = new EventBus();
    this.quests = new QuestSystem(this);

    this.turns.bus.on('turn:start', ({ player }) => {
      if (player) player.cardsPlayedThisTurn = 0;
      const bonus = player?.hero?.data?.nextSpellDamageBonus;
      if (bonus?.eachTurn) bonus.used = false;
      if (player?.hero) {
        player.hero.powerUsed = false;
        player.hero.data.attacked = false;
        for (const c of player.battlefield.cards) { if (c.data) c.data.attacked = false; }
        if (player.hero.passive?.length) {
          this.effects.execute(player.hero.passive, { game: this, player, card: player.hero });
        }
      }
      if (player) this.draw(player, 1);
    });

    // Players
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });

    this.state = { frame: 0, startedAt: 0 };
  }

  setUIRerender(fn) {
    this._uiRerender = fn;
  }

  async init() {
    if (this.rootEl && !this.rootEl.dataset.bound) {
      this.rootEl.innerHTML = '<p>Game initialized. Press Start.</p>';
      this.rootEl.dataset.bound = '1';
    }
    await this.setupMatch();
  }

  async setupMatch() {
    // Load initial libraries from card data
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const path = new URL('../../data/cards.json', import.meta.url);
      const txt = await fs.readFile(path, 'utf8');
      this.allCards = JSON.parse(txt);
    } else {
      const res = await fetch(new URL('../../data/cards.json', import.meta.url));
      this.allCards = await res.json();
    }

    const heroes = this.allCards.filter(c => c.type === 'hero');
    const otherCards = this.allCards.filter(c => c.type !== 'hero');

    const rng = this.rng;

    // Assign heroes
    const playerHeroData = rng.pick(heroes);
    this.player.hero = new Hero(playerHeroData);

    let opponentHeroData = rng.pick(heroes);
    while (opponentHeroData.id === playerHeroData.id) {
      opponentHeroData = rng.pick(heroes);
    }
    this.opponent.hero = new Hero(opponentHeroData);

    // Create player's library
    const playerLibData = [];
    for (let i = 0; i < 60; i++) {
      playerLibData.push(rng.pick(otherCards));
    }

    // Create opponent's library
    const opponentLibData = [];
    for (let i = 0; i < 60; i++) {
      opponentLibData.push(rng.pick(otherCards));
    }

    // Populate libraries
    this.player.library.cards = [];
    for (const cardData of playerLibData) {
      validateCardData(cardData);
      this.player.library.add(new Card(cardData));
    }
    this.opponent.library.cards = [];
    for (const cardData of opponentLibData) {
      validateCardData(cardData);
      this.opponent.library.add(new Card(cardData));
    }

    this.player.library.shuffle();
    this.opponent.library.shuffle();

    

    this.turns.setActivePlayer(this.player);
    // Draw opening hand
    this.draw(this.player, 3);
    this.draw(this.opponent, 3);
    this.turns.startTurn();
    this.resources.startTurn(this.player);
  }

  draw(player, n = 1) {
    const drawn = player.library.draw(n);
    for (const c of drawn) player.hand.add(c);
    return drawn.length;
  }

  async useHeroPower(player) {
    const hero = player?.hero;
    if (!hero || hero.powerUsed) return false;
    if (!hero.active?.length) return false;
    const cost = 2;
    if (!this.resources.pay(player, cost)) return false;
    await this.effects.execute(hero.active, { game: this, player, card: hero });
    hero.powerUsed = true;
    return true;
  }

  addCardToHand(cardId) {
    const cardData = this.allCards.find(c => c.id === cardId);
    if (cardData) {
      const newCard = new Card(cardData);
      this.player.hand.add(newCard);
      console.log(`Added ${newCard.name} to hand.`);
      if (this._uiRerender) {
        this._uiRerender();
      }
      return true;
    }
    console.warn(`Card with ID ${cardId} not found.`);
    return false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.state.startedAt = performance.now();
    this._lastTs = performance.now();
    const loop = (ts) => {
      if (!this.running) return;
      const dt = (ts - this._lastTs) / 1000;
      this._lastTs = ts;
      try { this.update(dt); } catch (e) { console.error(e); }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  update(dt) {
    this.state.frame++;
  }

  canPlay(player, card) {
    return this.resources.canPay(player, card.cost || 0);
  }

  

  async playFromHand(player, cardId) {
    const card = player.hand.cards.find(c => c.id === cardId);
    if (!card) return false;
    const cost = card.cost || 0;
    if (!this.resources.pay(player, cost)) return false;
    let tempSpellDamage = 0;
    const bonus = player.hero.data.nextSpellDamageBonus;
    if (card.type === 'spell' && bonus && !bonus.used) {
      player.hero.data.spellDamage = (player.hero.data.spellDamage || 0) + bonus.amount;
      bonus.used = true;
      tempSpellDamage = bonus.amount;
    }

    const comboActive = player.cardsPlayedThisTurn > 0;
    const context = { game: this, player, card };

    if (card.effects && card.effects.length > 0) {
      await this.effects.execute(card.effects, context);
    }

    if (comboActive && card.combo && card.combo.length > 0) {
      await this.effects.execute(card.combo, context);
    }

    if (tempSpellDamage) {
      player.hero.data.spellDamage -= tempSpellDamage;
    }

    if (card.type === 'ally' || card.type === 'equipment') {
      player.hand.moveTo(player.battlefield, cardId);
      if (card.type === 'equipment') player.hero.equipment.push(card);
    } else if (card.type === 'quest') {
      player.hand.moveTo(player.quests, cardId);
      this.quests.addQuest(player, card);
    } else {
      player.hand.moveTo(player.graveyard, cardId);
    }

    this.bus.emit('cardPlayed', { player, card });
    player.cardsPlayedThisTurn += 1;

    return true;
  }

  async promptTarget(candidates, { allowNoMore = false } = {}) {
    if (!candidates?.length) return null;
    if (typeof document === 'undefined') {
      return candidates[0];
    }
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'target-prompt';

      const list = document.createElement('ul');

      candidates.forEach((t) => {
        const li = document.createElement('li');
        li.textContent = t.name;
        li.addEventListener('click', () => {
          document.body.removeChild(overlay);
          resolve(t);
        });
        list.appendChild(li);
      });

      overlay.appendChild(list);

      if (allowNoMore) {
        const done = document.createElement('button');
        done.textContent = 'No more targets';
        done.addEventListener('click', () => {
          document.body.removeChild(overlay);
          resolve(null);
        });
        overlay.appendChild(done);
      }

      document.body.appendChild(overlay);
    });
  }

  async promptOption(options) {
    if (!options?.length) return 0;
    if (typeof document === 'undefined') {
      return 0;
    }
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'option-prompt';

      const list = document.createElement('ul');

      options.forEach((t, idx) => {
        const li = document.createElement('li');
        li.textContent = t;
        li.addEventListener('click', () => {
          document.body.removeChild(overlay);
          resolve(idx);
        });
        list.appendChild(li);
      });

      overlay.appendChild(list);
      document.body.appendChild(overlay);
    });
  }

  async attack(player, cardId, targetId = null) {
    const defender = player === this.player ? this.opponent : this.player;
    const card = [player.hero, ...player.battlefield.cards].find(c => c.id === cardId);
    if (!card) return false;
    const atk = typeof card.totalAttack === 'function' ? card.totalAttack() : (card.data?.attack ?? 0);
    if (atk < 1 || card.data?.attacked) return false;
    let target = null;
    const candidates = [defender.hero, ...defender.battlefield.cards];
    if (defender.battlefield.cards.length > 0) {
      if (targetId) {
        target = candidates.find(c => c.id === targetId) || null;
        if (target?.id === defender.hero.id) target = null;
      } else {
        const choice = await this.promptTarget(candidates);
        if (choice && choice.id !== defender.hero.id) target = choice;
      }
    }
    this.combat.clear();
    if (!this.combat.declareAttacker(card)) return false;
    this.combat.setDefenderHero(defender.hero);
    if (target) this.combat.assignBlocker(card.id, target);
    this.combat.resolve();
    this.cleanupDeaths(player, defender);
    this.cleanupDeaths(defender, player);
    card.data.attacked = true;
    return true;
  }

  cleanupDeaths(player, killer) {
    const dead = player.battlefield.cards.filter(c => c.data?.dead);
    for (const c of dead) {
      player.battlefield.moveTo(player.graveyard, c.id);
      if (killer) this.bus.emit('allyDefeated', { player: killer, card: c });
    }
  }

  async endTurn() {
    // AI's turn
    this.turns.setActivePlayer(this.opponent);
    this.turns.startTurn();
    this.resources.startTurn(this.opponent);
    const affordable = this.opponent.hand.cards.filter(c => this.canPlay(this.opponent, c)).sort((a,b)=> (a.cost||0)-(b.cost||0));
    if (affordable[0]) await this.playFromHand(this.opponent, affordable[0].id);
    for (const c of this.opponent.battlefield.cards) this.combat.declareAttacker(c);
    this.combat.setDefenderHero(this.player.hero);
    this.combat.resolve();
    this.cleanupDeaths(this.player, this.opponent);
    this.cleanupDeaths(this.opponent, this.player);

    // End AI's turn and start player's turn
    while(this.turns.current !== 'End') {
      this.turns.nextPhase();
    }
    this.turns.nextPhase(); // End -> Start, turn increments for player

    this.turns.setActivePlayer(this.player);
    this.turns.startTurn();
    this.resources.startTurn(this.player);
  }

  async reset() {
    this.state.frame = 0;
    this.state.startedAt = 0;
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });
    await this.setupMatch();
  }

  dispose() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.rootEl) this.rootEl.textContent = 'Disposed.';
  }
}
