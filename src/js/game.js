// Orchestrates core game lifecycle and a minimal playable engine.
import Player from './entities/player.js';
import Card from './entities/card.js';
import TurnSystem from './systems/turns.js';
import ResourceSystem from './systems/resources.js';
import CombatSystem from './systems/combat.js';

function makeAlly(name, cost, atk, hp) {
  return new Card({ type: 'ally', name, cost, data: { attack: atk, health: hp } });
}

export default class Game {
  constructor(rootEl, opts = {}) {
    this.rootEl = rootEl;
    this.opts = opts;
    this.running = false;
    this._raf = 0;
    this._lastTs = 0;

    // Systems
    this.turns = new TurnSystem();
    this.resources = new ResourceSystem();
    this.combat = new CombatSystem();

    // Players
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });

    // Attack selection
    this.attacking = new Set();

    this.state = { frame: 0, startedAt: 0 };
  }

  init() {
    if (this.rootEl && !this.rootEl.dataset.bound) {
      this.rootEl.innerHTML = '<p>Game initialized. Press Start.</p>';
      this.rootEl.dataset.bound = '1';
    }
    this.setupMatch();
  }

  setupMatch() {
    // Simple libraries
    const lib = [
      makeAlly('Footman', 1, 1, 2),
      makeAlly('Archer', 2, 2, 1),
      makeAlly('Knight', 3, 3, 3),
      makeAlly('Mage', 2, 3, 1),
      makeAlly('Golem', 4, 4, 5),
    ];
    for (const c of lib) this.player.library.add(c);
    for (const c of lib.map((x)=> makeAlly(x.name, x.cost, x.data.attack, x.data.health))) this.opponent.library.add(c);
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

  placeResource(player, cardId) {
    return this.resources.placeResource(player, cardId);
  }

  playFromHand(player, cardId) {
    const card = player.hand.cards.find(c => c.id === cardId);
    if (!card) return false;
    const cost = card.cost || 0;
    if (!this.resources.pay(player, cost)) return false;
    player.hand.moveTo(player.battlefield, cardId);
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
    // End player turn, then AI performs a simple turn
    this.turns.nextPhase(); // through End -> loops to Start
    this.turns.setActivePlayer(this.opponent);
    this.turns.startTurn();
    this.resources.startTurn(this.opponent);
    // AI: draw one, place a resource, play cheapest, attack all
    this.draw(this.opponent, 1);
    if (this.opponent.hand.size() > 0) this.placeResource(this.opponent, this.opponent.hand.cards[0].id);
    // play cheapest affordable once
    const affordable = this.opponent.hand.cards.filter(c => this.canPlay(this.opponent, c)).sort((a,b)=> (a.cost||0)-(b.cost||0));
    if (affordable[0]) this.playFromHand(this.opponent, affordable[0].id);
    // attack with all
    for (const c of this.opponent.battlefield.cards) this.combat.declareAttacker(c);
    this.combat.setDefenderHero(this.player.hero);
    this.combat.resolve();
    this.cleanupDeaths(this.player);
    this.cleanupDeaths(this.opponent);
    // Switch back to player
    this.turns.setActivePlayer(this.player);
    this.turns.startTurn();
    this.resources.startTurn(this.player);
    // Player draws one at start of turn
    this.draw(this.player, 1);
  }

  reset() {
    this.state.frame = 0;
    this.state.startedAt = 0;
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });
    this.attacking.clear();
    this.setupMatch();
  }

  dispose() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.rootEl) this.rootEl.textContent = 'Disposed.';
  }
}
