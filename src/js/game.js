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
import { selectTargets } from './systems/targeting.js';

export default class Game {
  constructor(rootEl, opts = {}) {
    this.rootEl = rootEl;
    this.opts = opts;
    this.running = false;
    this._raf = 0;
    this._lastTs = 0;
    // Sentinel for UI prompt cancellation
    this.CANCEL = Symbol('CANCEL');

    // Systems
    this.turns = new TurnSystem();
    this.resources = new ResourceSystem(this.turns);
    // Create the event bus before systems that depend on it
    this.bus = new EventBus();
    this.combat = new CombatSystem(this.bus);
    this.effects = new EffectSystem(this);
    // Use deterministic RNG in tests/node to stabilize content selection
    if (typeof window === 'undefined') {
      this.rng = new RNG(0xC0FFEE);
    } else {
      this.rng = new RNG();
    }
    this.quests = new QuestSystem(this);

      this.turns.bus.on('turn:start', ({ player }) => {
        if (player) {
          player.cardsPlayedThisTurn = 0;
          player.armorGainedThisTurn = 0;
        }
      const bonus = player?.hero?.data?.nextSpellDamageBonus;
      if (bonus?.eachTurn) bonus.used = false;
      if (player?.hero) {
        player.hero.powerUsed = false;
        // Reset per-turn attack state
        player.hero.data.attacked = false;
        player.hero.data.attacksUsed = 0;
        player.hero.data.summoningSick = false;
        for (const c of player.battlefield.cards) {
          if (c.data) {
            c.data.attacked = false;
            c.data.attacksUsed = 0;
            c.data.summoningSick = false;
          }
        }
        if (player.hero.passive?.length) {
          this.effects.execute(player.hero.passive, { game: this, player, card: player.hero });
        }
      }
        if (player) this.draw(player, 1);
      });

      this.turns.bus.on('phase:end', ({ phase }) => {
        if (phase === 'End') {
          const p = this.turns.activePlayer;
          if (p) {
            const all = [p.hero, ...p.battlefield.cards];
            for (const c of all) {
              const ft = c?.data?.freezeTurns || 0;
              if (ft > 0) c.data.freezeTurns = ft - 1;
            }
          }
        }
      });

    // Players
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });

    this.state = { frame: 0, startedAt: 0, difficulty: 'easy', debug: false };
  }

  setUIRerender(fn) {
    this._uiRerender = fn;
  }

  async init() {
    if (this.rootEl && !this.rootEl.dataset.bound) {
      // No start button; avoid showing an initialization prompt
      this.rootEl.innerHTML = '';
      this.rootEl.dataset.bound = '1';
    }
    await this.setupMatch();
  }

  async setupMatch(playerDeck = null) {
    // Load initial libraries from card data
    if (typeof window === 'undefined') {
      const fs = await import('fs/promises');
      const path1 = new URL('../../data/cards.json', import.meta.url);
      const txt1 = await fs.readFile(path1, 'utf8');
      const baseCards = JSON.parse(txt1);
      let extraCards = [];
      let extraCards2 = [];
      try {
        const path2 = new URL('../../data/cards-2.json', import.meta.url);
        const txt2 = await fs.readFile(path2, 'utf8');
        extraCards = JSON.parse(txt2);
      } catch (err) {
        // cards-2.json is optional in some environments; ignore if missing
      }
      try {
        const path3 = new URL('../../data/cards-3.json', import.meta.url);
        const txt3 = await fs.readFile(path3, 'utf8');
        extraCards2 = JSON.parse(txt3);
      } catch (err) {
        // cards-3.json is optional; ignore if missing
      }
      this.allCards = [...baseCards, ...extraCards, ...extraCards2];
    } else {
      const [res1, res2, res3] = await Promise.all([
        fetch(new URL('../../data/cards.json', import.meta.url)),
        // cards-2.json may not exist in some builds; fetch and ignore errors
        fetch(new URL('../../data/cards-2.json', import.meta.url)).catch(() => null),
        fetch(new URL('../../data/cards-3.json', import.meta.url)).catch(() => null)
      ]);
      const baseCards = await res1.json();
      let extraCards = [];
      let extraCards2 = [];
      if (res2 && res2.ok) {
        try { extraCards = await res2.json(); } catch {}
      }
      if (res3 && res3.ok) {
        try { extraCards2 = await res3.json(); } catch {}
      }
      this.allCards = [...baseCards, ...extraCards, ...extraCards2];
    }

    const heroes = this.allCards.filter(c => c.type === 'hero');
    const otherCards = this.allCards.filter(c => c.type !== 'hero');

    const rng = this.rng;

    // Clear previous zones
    this.player.hand.cards = [];
    this.player.battlefield.cards = [];
    this.opponent.hand.cards = [];
    this.opponent.battlefield.cards = [];

    // Assign player hero and library
    if (playerDeck?.hero && playerDeck.cards?.length === 60) {
      validateCardData(playerDeck.hero);
      this.player.hero = new Hero(playerDeck.hero);
      this.player.library.cards = [];
      for (const cardData of playerDeck.cards) {
        validateCardData(cardData);
        this.player.library.add(new Card(cardData));
      }
    } else {
      const playerHeroData = rng.pick(heroes);
      this.player.hero = new Hero(playerHeroData);
      const playerLibData = [];
      for (let i = 0; i < 60; i++) {
        playerLibData.push(rng.pick(otherCards));
      }
      this.player.library.cards = [];
      for (const cardData of playerLibData) {
        validateCardData(cardData);
        this.player.library.add(new Card(cardData));
      }
    }

    // Assign opponent hero and library
    let opponentHeroData = rng.pick(heroes);
    while (opponentHeroData.id === this.player.hero.id) {
      opponentHeroData = rng.pick(heroes);
    }
    this.opponent.hero = new Hero(opponentHeroData);
    const opponentLibData = [];
    for (let i = 0; i < 60; i++) {
      opponentLibData.push(rng.pick(otherCards));
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
    if (hero.data?.freezeTurns > 0) return false;
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
    // RAF loop removed; gameplay is event-driven via DOM/UI actions
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
    const context = { game: this, player, card, comboActive };

    let primaryEffects = card.effects;
    let comboEffects = comboActive && card.combo && card.combo.length > 0 ? card.combo : null;

    // For spells with combo effects that replace the base effect, only execute the combo effects
    if (comboActive && card.type === 'spell' && comboEffects) {
      primaryEffects = comboEffects;
      comboEffects = null;
    }

    try {
      if (primaryEffects && primaryEffects.length > 0) {
        const hasDeathrattle = card.keywords?.includes('Deathrattle');
        if (card.type === 'ally' && hasDeathrattle) {
          card.deathrattle = primaryEffects;
          card.effects = [];
        } else {
          await this.effects.execute(primaryEffects, context);
        }
      }

      if (comboEffects) {
        await this.effects.execute(comboEffects, context);
      }
    } catch (err) {
      if (err === this.CANCEL) {
        // Refund cost and revert temporary spell damage bonus consumption
        if (typeof this.resources.refund === 'function') this.resources.refund(player, cost);
        else this.resources.restore(player, cost);
        if (tempSpellDamage) {
          player.hero.data.spellDamage -= tempSpellDamage;
          if (bonus) bonus.used = false;
        }
        return false;
      }
      throw err;
    }

    if (tempSpellDamage) {
      player.hero.data.spellDamage -= tempSpellDamage;
    }

    if (card.type === 'ally' || card.type === 'equipment') {
      player.hand.moveTo(player.battlefield, cardId);
      if (card.type === 'equipment') player.equip(card);
      if (card.type === 'ally') {
        // Track the turn the ally entered play to reason about Rush/Charge
        card.data = card.data || {};
        card.data.enteredTurn = this.turns.turn;
      }
      if (card.type === 'ally' && !(card.keywords?.includes('Rush') || card.keywords?.includes('Charge'))) {
        card.data = card.data || {};
        card.data.attacked = true;
        card.data.summoningSick = true;
      }
      // Initialize Divine Shield on allies that have the keyword when entering play
      if (card.type === 'ally' && card.keywords?.includes('Divine Shield')) {
        card.data = card.data || {};
        card.data.divineShield = true;
      }
    } else if (card.type === 'quest') {
      player.hand.moveTo(player.battlefield, cardId);
      this.quests.addQuest(player, card);
    } else {
      player.hand.moveTo(player.graveyard, cardId);
    }

    this.bus.emit('cardPlayed', { player, card });
    player.log.push(`Played ${card.name}`);
    player.cardsPlayedThisTurn += 1;

    return true;
  }

  async promptTarget(candidates, { allowNoMore = false } = {}) {
    candidates = candidates?.filter(c => c.type !== 'quest');
    if (!candidates?.length) return null;

    // If it's the AI's turn, favor enemy targets when auto-selecting
    if (this.turns.activePlayer && this.turns.activePlayer !== this.player) {
      const active = this.turns.activePlayer;
      const enemy = active === this.player ? this.opponent : this.player;
      const enemyTargets = candidates.filter(
        c => c === enemy.hero || enemy.battlefield.cards.includes(c)
      );
      const pool = enemyTargets.length ? enemyTargets : candidates;
      return this.rng.pick(pool);
    }

    if (typeof document === 'undefined') {
      return candidates[0];
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'target-prompt';

      const list = document.createElement('ul');

      // Order: enemy hero, enemy allies, player hero, player allies
      const enemy = this.opponent;
      const me = this.player;
      const inCands = new Set(candidates);

      const ordered = [];
      if (inCands.has(enemy.hero)) ordered.push(enemy.hero);
      for (const c of enemy.battlefield.cards) {
        if (inCands.has(c)) ordered.push(c);
      }
      if (inCands.has(me.hero)) ordered.push(me.hero);
      for (const c of me.battlefield.cards) {
        if (inCands.has(c)) ordered.push(c);
      }
      // Append any remaining candidates not covered above
      for (const c of candidates) {
        if (!ordered.includes(c)) ordered.push(c);
      }

      ordered.forEach((t) => {
        const li = document.createElement('li');
        const isEnemy = (t === enemy.hero) || enemy.battlefield.cards.includes(t);
        li.textContent = isEnemy ? `${t.name} (AI)` : t.name;
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

      // Always provide a cancel option to close without choosing
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(this.CANCEL);
      });
      overlay.appendChild(cancel);

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

      // Add a cancel button to allow backing out of the choice
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(this.CANCEL);
      });
      overlay.appendChild(cancel);
      document.body.appendChild(overlay);
    });
  }

  async attack(player, cardId, targetId = null) {
    const defender = player === this.player ? this.opponent : this.player;
    const card = [player.hero, ...player.battlefield.cards].find(c => c.id === cardId);
    if (!card) return false;
    const atk = typeof card.totalAttack === 'function' ? card.totalAttack() : (card.data?.attack ?? 0);
    if (atk < 1) return false;
    // Block if summoning sick (no Rush)
    if (card?.data?.summoningSick) return false;
    // Rush restriction: if the attacker has Rush and just entered this turn, it cannot hit the hero
    const hasRush = !!card?.keywords?.includes?.('Rush');
    const justEntered = !!(card?.data?.enteredTurn && card.data.enteredTurn === this.turns.turn);
    const maxAttacks = card?.keywords?.includes?.('Windfury') ? 2 : 1;
    const used = card?.data?.attacksUsed || 0;
    if (used >= maxAttacks) return false;
    let target = null;
    const candidates = [
      defender.hero,
      ...defender.battlefield.cards.filter(c => c.type !== 'equipment' && c.type !== 'quest')
    ];
    const legal = selectTargets(candidates);
    // For Rush on the turn it was summoned: require an enemy ally target; if none, the attack is not legal
    const pool = (hasRush && justEntered) ? legal.filter(c => c.id !== defender.hero.id) : legal;
    if ((hasRush && justEntered) && pool.length === 0) return false;
    if (pool.length === 1) {
      const only = pool[0];
      if (only.id !== defender.hero.id) target = only;
    } else if (pool.length > 1) {
      if (targetId) {
        target = pool.find(c => c.id === targetId) || null;
        if (target?.id === defender.hero.id) target = null;
      } else {
        const choice = await this.promptTarget(pool);
        if (choice === this.CANCEL) return false; // respect cancel
        // If the enemy hero was chosen, leave target null to attack hero directly
        if (choice && choice.id !== defender.hero.id) target = choice;
      }
    }
    this.combat.clear();
    if (!this.combat.declareAttacker(card)) return false;
    this.combat.setDefenderHero(defender.hero);
    if (target) this.combat.assignBlocker(card.id, target);
    const events = this.combat.resolve();
    for (const ev of events) {
      const srcOwner = [player.hero, ...player.battlefield.cards].includes(ev.source) ? player : defender;
      this.bus.emit('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
    }
    await this.cleanupDeaths(player, defender);
    await this.cleanupDeaths(defender, player);
    const actualTarget = target || defender.hero;
    player.log.push(`Attacked ${actualTarget.name} with ${card.name}`);
    // Mark attack usage
    card.data.attacked = true;
    card.data.attacksUsed = (card.data.attacksUsed || 0) + 1;
    // Stealth is lost when a unit attacks
    if (card?.keywords?.includes?.('Stealth')) {
      card.keywords = card.keywords.filter(k => k !== 'Stealth');
    }
    return true;
  }

  async cleanupDeaths(player, killer) {
    const dead = player.battlefield.cards.filter(c => c.data?.dead);
    for (const c of dead) {
      player.battlefield.moveTo(player.graveyard, c.id);
      if (c.keywords?.includes('Deathrattle') && c.deathrattle?.length) {
        await this.effects.execute(c.deathrattle, { game: this, player, card: c });
      }
      if (killer) this.bus.emit('allyDefeated', { player: killer, card: c });
    }
  }

  async endTurn() {
    // AI's turn
    this.turns.setActivePlayer(this.opponent);
    this.turns.startTurn();
    this.resources.startTurn(this.opponent);

    const diff = this.state?.difficulty || 'easy';
    if (diff === 'nightmare') {
      // Neural network AI (nightmare)
      const { default: NeuralAI, loadModelFromDiskOrFetch } = await import('./systems/ai-nn.js');
      // Lazy-load model if not already set
      await loadModelFromDiskOrFetch();
      const ai = new NeuralAI({ game: this, resourceSystem: this.resources, combatSystem: this.combat });
      if (this.state) this.state.aiThinking = true;
      this.bus.emit('ai:thinking', { thinking: true });
      try {
        await ai.takeTurn(this.opponent, this.player);
      } finally {
        if (this.state) this.state.aiThinking = false;
        this.bus.emit('ai:thinking', { thinking: false });
      }
    } else if (diff === 'medium' || diff === 'hard') {
      // Use MCTS for medium/hard; hard uses deeper search
      const { default: MCTS_AI } = await import('./systems/ai-mcts.js');
      const ai = new MCTS_AI({
        resourceSystem: this.resources,
        combatSystem: this.combat,
        game: this,
        ...(diff === 'hard' ? { iterations: 5000, rolloutDepth: 10 } : {})
      });
      // Mark AI as thinking to allow UI to disable controls
      if (this.state) this.state.aiThinking = true;
      this.bus.emit('ai:thinking', { thinking: true });
      try {
        await ai.takeTurn(this.opponent, this.player);
      } finally {
        if (this.state) this.state.aiThinking = false;
        this.bus.emit('ai:thinking', { thinking: false });
      }
    } else {
      // Easy difficulty: previous simple heuristic flow
      const affordable = this.opponent.hand.cards
        .filter(c => this.canPlay(this.opponent, c))
        .sort((a,b)=> (a.cost||0)-(b.cost||0));
      if (affordable[0]) await this.playFromHand(this.opponent, affordable[0].id);
      const attackers = this.opponent.battlefield.cards.filter(c => {
        if (!(c.type === 'ally' || c.type === 'equipment')) return false;
        const atk = typeof c.totalAttack === 'function' ? c.totalAttack() : (c.data?.attack || 0);
        const maxAttacks = c?.keywords?.includes?.('Windfury') ? 2 : 1;
        const used = c?.data?.attacksUsed || 0;
        return atk > 0 && !c?.data?.summoningSick && used < maxAttacks;
      });
      for (const c of attackers) {
        // Enforce Rush restriction on entry: must have a non-hero target available
        const hasRush = !!c?.keywords?.includes?.('Rush');
        const justEntered = !!(c?.data?.enteredTurn && c.data.enteredTurn === this.turns.turn);
        // Stealth is lost when a unit attacks (AI - easy difficulty path)
        const defenders = [
          this.player.hero,
          ...this.player.battlefield.cards.filter(d => d.type !== 'equipment' && d.type !== 'quest')
        ];
        const legal = selectTargets(defenders);
        // If Rush on entry and no non-hero targets, skip attacking with this unit
        if (hasRush && justEntered) {
          const nonHero = legal.filter(t => t.id !== this.player.hero.id);
          if (nonHero.length === 0) continue;
        }
        const declared = this.combat.declareAttacker(c);
        if (!declared) continue;
        if (c.data) {
          c.data.attacked = true;
          c.data.attacksUsed = (c.data.attacksUsed || 0) + 1;
        }
        if (c?.keywords?.includes?.('Stealth')) {
          c.keywords = c.keywords.filter(k => k !== 'Stealth');
        }
        let block = null;
        if (legal.length === 1) {
          const only = legal[0];
          if (only.id !== this.player.hero.id) block = only;
        } else if (legal.length > 1) {
          const choices = legal.filter(t => t.id !== this.player.hero.id);
          block = this.rng.pick(choices);
        }
        const target = block || this.player.hero;
        if (block) this.combat.assignBlocker(c.id, block);
        this.opponent.log.push(`Attacked ${target.name} with ${c.name}`);
      }
      this.combat.setDefenderHero(this.player.hero);
      const events = this.combat.resolve();
      for (const ev of events) {
        const srcOwner = [this.opponent.hero, ...this.opponent.battlefield.cards].includes(ev.source) ? this.opponent : this.player;
        this.bus.emit('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
      }
      await this.cleanupDeaths(this.player, this.opponent);
      await this.cleanupDeaths(this.opponent, this.player);
    }

    // End AI's turn and start player's turn
    while(this.turns.current !== 'End') {
      this.turns.nextPhase();
    }
    this.turns.nextPhase(); // End -> Start, turn increments for player

    this.turns.setActivePlayer(this.player);
    this.turns.startTurn();
    this.resources.startTurn(this.player);
  }

  async reset(playerDeck = null) {
    this.state.frame = 0;
    this.state.startedAt = 0;
    this.turns.turn = 1;
    this.turns.current = 'Start';
    this.turns.activePlayer = null;
    this.resources = new ResourceSystem(this.turns);
    this.player = new Player({ name: 'You' });
    this.opponent = new Player({ name: 'AI' });
    await this.setupMatch(playerDeck);
  }

  dispose() {
    this.running = false;
    this._raf = 0;
    if (this.rootEl) this.rootEl.textContent = 'Disposed.';
  }
}
