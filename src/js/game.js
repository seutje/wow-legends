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
import { logSecretTriggered } from './utils/combatLog.js';

export default class Game {
  constructor(rootEl, opts = {}) {
    this.rootEl = rootEl;
    this.opts = opts;
    const aiHint = opts?.aiPlayers;
    let aiList;
    if (Array.isArray(aiHint)) aiList = aiHint;
    else if (aiHint instanceof Set) aiList = Array.from(aiHint);
    else if (typeof aiHint === 'string') aiList = [aiHint];
    else aiList = (typeof window === 'undefined') ? ['player', 'opponent'] : ['opponent'];
    this.aiPlayers = new Set(aiList.filter((p) => p === 'player' || p === 'opponent'));
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
        const difficulty = this.state?.difficulty || 'easy';
        const opponentIsAI = typeof this.aiPlayers?.has === 'function' && this.aiPlayers.has('opponent');
        const aiHandlesDraw = opponentIsAI
          && player === this.opponent
          && (difficulty === 'medium' || difficulty === 'hard' || difficulty === 'nightmare');
        if (player && !aiHandlesDraw) this.draw(player, 1);
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
      const types = ['hero', 'spell', 'ally', 'equipment', 'quest', 'consumable'];
      const chunks = [];
      for (const t of types) {
        try {
          const p = new URL(`../../data/cards/${t}.json`, import.meta.url);
          const txt = await fs.readFile(p, 'utf8');
          chunks.push(JSON.parse(txt));
        } catch (err) {
          // Missing type file is allowed; continue
        }
      }
      this.allCards = chunks.flat();
    } else {
      const mk = (name) => fetch(new URL(`../../data/cards/${name}.json`, import.meta.url)).catch(() => null);
      const [h, s, a, e, q, c] = await Promise.all([
        mk('hero'), mk('spell'), mk('ally'), mk('equipment'), mk('quest'), mk('consumable')
      ]);
      const parts = [];
      for (const r of [h, s, a, e, q, c]) {
        if (r && r.ok) {
          try { parts.push(await r.json()); } catch {}
        }
      }
      this.allCards = parts.flat();
    }

    const heroes = this.allCards.filter(c => c.type === 'hero');
    const otherCards = this.allCards.filter(c => c.type !== 'hero');
    const nonQuestCards = otherCards.filter(c => c.type !== 'quest');

    const rng = this.rng;
    const aiPlayers = this.aiPlayers instanceof Set ? this.aiPlayers : new Set();
    const playerIsAI = aiPlayers.has('player');
    const opponentIsAI = aiPlayers.has('opponent');
    const buildLibraryData = (cards, allowQuest) => {
      const sanitized = [];
      if (Array.isArray(cards)) {
        for (const cardData of cards) {
          if (!cardData) continue;
          if (!allowQuest && cardData.type === 'quest') continue;
          sanitized.push(cardData);
        }
      }
      const pool = allowQuest ? otherCards : nonQuestCards;
      while (sanitized.length < 60 && pool.length > 0) {
        sanitized.push(rng.pick(pool));
      }
      if (sanitized.length > 60) sanitized.length = 60;
      return sanitized;
    };

    // Clear previous zones
    this.player.hand.cards = [];
    this.player.battlefield.cards = [];
    this.opponent.hand.cards = [];
    this.opponent.battlefield.cards = [];

    // Assign player hero and library
    if (playerDeck?.hero && playerDeck.cards?.length === 60) {
      validateCardData(playerDeck.hero);
      this.player.hero = new Hero(playerDeck.hero);
      // Ensure ownership is set for systems that depend on it (e.g., combat reflection)
      this.player.hero.owner = this.player;
      const playerLibData = buildLibraryData(playerDeck.cards, !playerIsAI);
      this.player.library.cards = [];
      for (const cardData of playerLibData) {
        validateCardData(cardData);
        this.player.library.add(new Card(cardData));
      }
    } else {
      const playerHeroData = rng.pick(heroes);
      this.player.hero = new Hero(playerHeroData);
      this.player.hero.owner = this.player;
      const playerLibData = buildLibraryData(null, !playerIsAI);
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
    this.opponent.hero.owner = this.opponent;
    const opponentLibData = buildLibraryData(null, !opponentIsAI);
    this.opponent.library.cards = [];
    for (const cardData of opponentLibData) {
      validateCardData(cardData);
      this.opponent.library.add(new Card(cardData));
    }

    this.player.library.shuffle(rng);
    this.opponent.library.shuffle(rng);



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
    // Combat log indicator for hero power usage
    if (player?.log) player.log.push('Used hero power');
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
    // Check opponent secrets that may counter spells before any effects resolve
    const defender = (player === this.player) ? this.opponent : this.player;
    const oppSecrets = Array.isArray(defender?.hero?.data?.secrets) ? defender.hero.data.secrets : [];
    const counterIdx = (card.type === 'spell') ? oppSecrets.findIndex(s => s?.type === 'counterShot') : -1;
    if (counterIdx >= 0) {
      // Consume the counter secret and fizzle the spell
      const tok = oppSecrets.splice(counterIdx, 1)[0] || null;
      const searchZones = [
        defender.hand,
        defender.graveyard,
        defender.battlefield,
        defender.library,
        defender.removed,
      ];
      const secretCard = tok?.cardId
        ? searchZones.map((zone) => zone?.cards?.find?.((c) => c.id === tok.cardId)).find(Boolean) || null
        : null;
      logSecretTriggered(this, defender, { card: secretCard, token: tok });
      try { this.bus.emit('secret:removed', { player: defender, card: null }); } catch {}
      try { this._uiRerender?.(); } catch {}
      // Move spell straight to graveyard without resolving effects
      player.hand.moveTo(player.graveyard, card);
      this.bus.emit('cardPlayed', { player, card });
      player.log.push(`Played ${card.name} (countered)`);
      player.cardsPlayedThisTurn += 1;
      return true;
    }
    let tempSpellDamage = 0;
    const bonus = player.hero.data.nextSpellDamageBonus;
    let bonusSourceId = null;
    if (card.type === 'spell' && bonus && !bonus.used) {
      player.hero.data.spellDamage = (player.hero.data.spellDamage || 0) + bonus.amount;
      bonus.used = true;
      tempSpellDamage = bonus.amount;
      bonusSourceId = bonus.sourceCardId || null;
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

    const isAlly = card.type === 'ally';
    const capturePresence = (data, key) => ({
      value: data[key],
      present: Object.prototype.hasOwnProperty.call(data, key),
    });
    let movedAllyBeforeEffects = false;
    let allyDataSnapshot = null;
    let originalHandIndex = -1;

    if (isAlly) {
      originalHandIndex = player.hand.cards.indexOf(card);
      player.hand.moveTo(player.battlefield, card);
      movedAllyBeforeEffects = true;
      const data = card.data || (card.data = {});
      allyDataSnapshot = {
        attacked: capturePresence(data, 'attacked'),
        summoningSick: capturePresence(data, 'summoningSick'),
        enteredTurn: capturePresence(data, 'enteredTurn'),
        divineShield: capturePresence(data, 'divineShield'),
      };
      data.enteredTurn = this.turns.turn;
      if (!(card.keywords?.includes('Rush') || card.keywords?.includes('Charge'))) {
        data.attacked = true;
        data.summoningSick = true;
      }
      if (card.keywords?.includes('Divine Shield')) {
        data.divineShield = true;
      }
    }

    const restoreAllyPlacement = () => {
      if (!movedAllyBeforeEffects) return;
      player.battlefield.remove(card);
      const handCards = player.hand.cards;
      const normalizeIndex = (idx, arr) => {
        if (typeof idx !== 'number' || Number.isNaN(idx)) return arr.length;
        if (idx < 0) return 0;
        if (idx > arr.length) return arr.length;
        return idx;
      };
      let desiredIndex = normalizeIndex(originalHandIndex, handCards);
      const currentIndex = handCards.indexOf(card);
      if (currentIndex === -1) {
        handCards.splice(desiredIndex, 0, card);
      } else if (currentIndex !== desiredIndex) {
        handCards.splice(currentIndex, 1);
        desiredIndex = normalizeIndex(originalHandIndex, handCards);
        handCards.splice(desiredIndex, 0, card);
      }
      const data = card.data || (card.data = {});
      const restore = (key, info) => {
        if (!info || !info.present) delete data[key];
        else data[key] = info.value;
      };
      restore('attacked', allyDataSnapshot?.attacked);
      restore('summoningSick', allyDataSnapshot?.summoningSick);
      restore('enteredTurn', allyDataSnapshot?.enteredTurn);
      restore('divineShield', allyDataSnapshot?.divineShield);
      movedAllyBeforeEffects = false;
    };

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
        restoreAllyPlacement();
        // Refund cost and revert temporary spell damage bonus consumption
        if (typeof this.resources.refund === 'function') this.resources.refund(player, cost);
        else this.resources.restore(player, cost);
        if (tempSpellDamage) {
          player.hero.data.spellDamage -= tempSpellDamage;
          if (bonus) bonus.used = false;
        }
        return false;
      }
      restoreAllyPlacement();
      throw err;
    }

    if (tempSpellDamage) {
      if (bonusSourceId) {
        const eqList = Array.isArray(player.hero.equipment) ? player.hero.equipment : [];
        const eq = eqList.find(e => e?.id === bonusSourceId);
        if (eq && typeof eq.durability === 'number') {
          eq.durability -= 1;
          if (player?.log) player.log.push(`${eq.name} empowered a spell (-1 durability).`);
          if (eq.durability <= 0) {
            if (player?.log) player.log.push(`${eq.name} broke and was destroyed.`);
            let moved = false;
            if (player?.battlefield && player?.graveyard) {
              const res = player.battlefield.moveTo(player.graveyard, eq);
              moved = !!res;
            }
            if (!moved && player?.graveyard?.add) {
              player.graveyard.add(eq);
            }
            if (player?.hero?.data?.nextSpellDamageBonus?.sourceCardId === bonusSourceId) {
              delete player.hero.data.nextSpellDamageBonus;
            }
          }
          player.hero.equipment = eqList.filter(e => (e?.durability ?? 1) > 0);
        } else if (player?.hero?.data?.nextSpellDamageBonus?.sourceCardId === bonusSourceId) {
          delete player.hero.data.nextSpellDamageBonus;
        }
      }

      player.hero.data.spellDamage -= tempSpellDamage;
    }

    if (card.type === 'equipment') {
      player.hand.moveTo(player.battlefield, card);
      player.equip(card);
    } else if (card.type === 'ally') {
      if (!movedAllyBeforeEffects) {
        player.hand.moveTo(player.battlefield, card);
        const data = card.data || (card.data = {});
        data.enteredTurn = this.turns.turn;
        if (!(card.keywords?.includes('Rush') || card.keywords?.includes('Charge'))) {
          data.attacked = true;
          data.summoningSick = true;
        }
        if (card.keywords?.includes('Divine Shield')) {
          data.divineShield = true;
        }
      }
    } else if (card.type === 'quest') {
      player.hand.moveTo(player.battlefield, card);
      this.quests.addQuest(player, card);
    } else {
      player.hand.moveTo(player.graveyard, card);
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
    const actualTarget = target || defender.hero;
    this.combat.clear();
    if (!this.combat.declareAttacker(card, actualTarget)) return false;
    this.combat.setDefenderHero(defender.hero);
    if (target) this.combat.assignBlocker(card.id, target);
    const events = this.combat.resolve();
    for (const ev of events) {
      const srcOwner = [player.hero, ...player.battlefield.cards].includes(ev.source) ? player : defender;
      this.bus.emit('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
    }
    // Allow UI to reflect HP changes before removals
    if (this._uiRerender) {
      try { this._uiRerender(); } catch {}
    }
    await this.cleanupDeaths(player, defender);
    await this.cleanupDeaths(defender, player);
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
      // Move the exact instance that died, not the first with matching id
      player.battlefield.moveTo(player.graveyard, c);
      if (c.keywords?.includes('Deathrattle') && c.deathrattle?.length) {
        await this.effects.execute(c.deathrattle, { game: this, player, card: c });
      }
      if (killer) this.bus.emit('allyDefeated', { player: killer, card: c });
    }
  }

  async endTurn() {
    // Tick down end-of-turn freeze for the player before handing control to AI
    {
      const p = this.player;
      const all = [p.hero, ...p.battlefield.cards];
      for (const c of all) {
        const ft = c?.data?.freezeTurns || 0;
        if (ft > 0) c.data.freezeTurns = ft - 1;
      }
    }

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
      if (this.state) this.state.aiPending = { type: 'mcts', stage: 'queued' };
      const ai = await this._createMctsAI(diff);
      // Mark AI as thinking to allow UI to disable controls
      if (this.state) this.state.aiThinking = true;
      this.bus.emit('ai:thinking', { thinking: true });
      try {
        await ai.takeTurn(this.opponent, this.player);
      } finally {
        if (this.state) {
          this.state.aiThinking = false;
          this.state.aiPending = null;
        }
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
        let block = null;
        if (legal.length === 1) {
          const only = legal[0];
          if (only.id !== this.player.hero.id) block = only;
        } else if (legal.length > 1) {
          const choices = legal.filter(t => t.id !== this.player.hero.id);
          block = this.rng.pick(choices);
        }
        const target = block || this.player.hero;
        const declared = this.combat.declareAttacker(c, target);
        if (!declared) continue;
        if (c.data) {
          c.data.attacked = true;
          c.data.attacksUsed = (c.data.attacksUsed || 0) + 1;
        }
        if (c?.keywords?.includes?.('Stealth')) {
          c.keywords = c.keywords.filter(k => k !== 'Stealth');
        }
        if (block) this.combat.assignBlocker(c.id, block);
        this.opponent.log.push(`Attacked ${target.name} with ${c.name}`);
      }
      this.combat.setDefenderHero(this.player.hero);
      const events = this.combat.resolve();
      for (const ev of events) {
        const srcOwner = [this.opponent.hero, ...this.opponent.battlefield.cards].includes(ev.source) ? this.opponent : this.player;
        this.bus.emit('damageDealt', { player: srcOwner, source: ev.source, amount: ev.amount, target: ev.target });
      }
      // Allow UI to reflect HP changes before removals
      if (this._uiRerender) {
        try { this._uiRerender(); } catch {}
      }
      await this.cleanupDeaths(this.player, this.opponent);
      await this.cleanupDeaths(this.opponent, this.player);
    }

    // End AI's turn and start player's turn
    await this._finalizeOpponentTurn();
  }

  async resumePendingAITurn() {
    const pending = this.state?.aiPending;
    if (!pending || pending.type !== 'mcts') return false;
    const diff = this.state?.difficulty || 'easy';
    if (!(diff === 'medium' || diff === 'hard')) {
      if (this.state) {
        this.state.aiPending = null;
        this.state.aiThinking = false;
      }
      this.bus.emit('ai:thinking', { thinking: false });
      return false;
    }
    if (this.turns.activePlayer !== this.opponent) {
      if (this.state) {
        this.state.aiPending = null;
        this.state.aiThinking = false;
      }
      this.bus.emit('ai:thinking', { thinking: false });
      return false;
    }
    const resume = pending.stage && pending.stage !== 'queued';
    const ai = await this._createMctsAI(diff);
    try {
      await ai.takeTurn(this.opponent, this.player, { resume });
    } finally {
      if (this.state) {
        this.state.aiThinking = false;
        this.state.aiPending = null;
      }
      this.bus.emit('ai:thinking', { thinking: false });
    }
    await this._finalizeOpponentTurn();
    return true;
  }

  async _createMctsAI(diff) {
    if (typeof this.opts?.createMctsAI === 'function') {
      const custom = await this.opts.createMctsAI(diff, this);
      if (custom) return custom;
    }
    const { default: MCTS_AI } = await import('./systems/ai-mcts.js');
    const config = {
      resourceSystem: this.resources,
      combatSystem: this.combat,
      game: this,
    };
    if (diff === 'hard') Object.assign(config, { iterations: 10000, rolloutDepth: 20 });
    return new MCTS_AI(config);
  }

  async _finalizeOpponentTurn() {
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
    if (this.effects?.reset) {
      this.effects.reset();
    }
    if (this.quests?.reset) {
      this.quests.reset();
    }
    if (typeof this.combat?.clear === 'function') {
      this.combat.clear();
      this.combat.setDefenderHero(null);
    }
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
