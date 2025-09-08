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

    // Players
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });

    // Attack selection
    this.attacking = new Set();

    this.state = { frame: 0, startedAt: 0 };
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
    let allCards;
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const path = new URL('../../data/cards.json', import.meta.url);
      const txt = await fs.readFile(path, 'utf8');
      allCards = JSON.parse(txt);
    } else {
      const res = await fetch(new URL('../../data/cards.json', import.meta.url));
      allCards = await res.json();
    }

    const heroes = allCards.filter(c => c.type === 'hero');
    const otherCards = allCards.filter(c => c.type !== 'hero');

    const rng = new RNG();

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
    this.turns.startTurn();
    this.resources.startTurn(this.player);
    // Draw opening hand
    this.draw(this.player, 3);
    this.draw(this.opponent, 3);
  }

  draw(player, n = 1) {
    const drawn = player.library.draw(n);
    for (const c of drawn) player.hand.add(c);
    return drawn.length;
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

  

  playFromHand(player, cardId) {
    const card = player.hand.cards.find(c => c.id === cardId);
    if (!card) return false;
    const cost = card.cost || 0;
    if (!this.resources.pay(player, cost)) return false;

    // Execute the card's effect
    if (card.effects && card.effects.length > 0) {
      this.effects.execute(card.effects, { player: player, card: card });
    }

    // Move the card to the appropriate zone
    if (card.data.type === 'ally' || card.data.type === 'equipment') {
      player.hand.moveTo(player.battlefield, cardId);
    } else {
      player.hand.moveTo(player.graveyard, cardId);
    }

    return true;
  }

  toggleAttacker(player, cardId) {
    const card = player.battlefield.cards.find(c => c.id === cardId);
    if (!card) return false;
    if (this.attacking.has(cardId)) this.attacking.delete(cardId);
    else this.attacking.add(cardId);
    return true;
  }

  resolveCombat(attacker = this.player, defender = this.opponent) {
    this.combat.clear();
    for (const id of this.attacking) {
      const card = attacker.battlefield.cards.find(c => c.id === id);
      if (card) this.combat.declareAttacker(card);
    }
    this.combat.setDefenderHero(defender.hero);
    this.combat.resolve();
    this.cleanupDeaths(attacker);
    this.cleanupDeaths(defender);
    this.attacking.clear();
    return true;
  }

  cleanupDeaths(player) {
    const dead = player.battlefield.cards.filter(c => c.data?.dead);
    for (const c of dead) player.battlefield.moveTo(player.graveyard, c.id);
  }

  endTurn() {
    // AI's turn
    this.turns.setActivePlayer(this.opponent);
    this.turns.startTurn();
    this.resources.startTurn(this.opponent);
    this.draw(this.opponent, 1);
    const affordable = this.opponent.hand.cards.filter(c => this.canPlay(this.opponent, c)).sort((a,b)=> (a.cost||0)-(b.cost||0));
    if (affordable[0]) this.playFromHand(this.opponent, affordable[0].id);
    for (const c of this.opponent.battlefield.cards) this.combat.declareAttacker(c);
    this.combat.setDefenderHero(this.player.hero);
    this.combat.resolve();
    this.cleanupDeaths(this.player);
    this.cleanupDeaths(this.opponent);

    // End AI's turn and start player's turn
    while(this.turns.current !== 'End') {
      this.turns.nextPhase();
    }
    this.turns.nextPhase(); // End -> Start, turn increments for player

    this.turns.setActivePlayer(this.player);
    this.turns.startTurn();
    this.resources.startTurn(this.player);
    this.draw(this.player, 1);
  }

  async reset() {
    this.state.frame = 0;
    this.state.startedAt = 0;
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });
    this.attacking.clear();
    await this.setupMatch();
  }

  dispose() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.rootEl) this.rootEl.textContent = 'Disposed.';
  }
}
