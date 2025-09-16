import Card from '../entities/card.js';
import Equipment from '../entities/equipment.js';
import { freezeTarget, getSpellDamageBonus, computeSpellDamage, isTargetable } from './keywords.js';
import { selectTargets } from './targeting.js';

export class EffectSystem {
  constructor(game) {
    this.game = game;
    this.effectRegistry = new Map();
    this.temporaryEffects = [];
    this.registerDefaults();

    this.game.turns.bus.on('phase:end', ({ phase }) => {
      if (phase === 'End') {
        this.cleanupTemporaryEffects();
      }
    });
  }

  async execute(cardEffects, context) {
    for (let i = 0; i < cardEffects.length; i++) {
      const effect = cardEffects[i];

      if (effect.type === 'buff' && effect.target === 'character') {
        const grouped = [effect];
        let j = i + 1;
        while (
          j < cardEffects.length &&
          cardEffects[j].type === 'buff' &&
          cardEffects[j].target === 'character'
        ) {
          grouped.push(cardEffects[j]);
          j++;
        }

        const { player, game } = context;
        const opponent = player === game.player ? game.opponent : game.player;
        // If any grouped buff has a negative amount, treat it as a debuff and allow enemy targets
        const isDebuff = grouped.some(g => typeof g.amount === 'number' && g.amount < 0);

        let candidates = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter(isTargetable);

        if (isDebuff) {
          const enemy = selectTargets([
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
          ]);
          candidates = [...candidates, ...enemy];
        }
        const chosen = await game.promptTarget(candidates);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) {
          for (const g of grouped) {
            await this.applyBuff(g, context, chosen);
          }
        }
        i = j - 1;
        continue;
      }

      switch (effect.type) {
        case 'damage':
          await this.dealDamage(effect, context);
          break;
        case 'buffAtEndOfTurn':
          this.buffAtEndOfTurn(effect, context);
          break;
        case 'summon':
          await this.summonUnit(effect, context);
          break;
        case 'summonBuff':
          this.registerSummonBuff(effect, context);
          break;
        case 'buff':
          await this.applyBuff(effect, context);
          break;
        case 'buffBeast':
          await this.buffBeast(effect, context);
          break;
        case 'buffOnArmorGain':
          this.buffOnArmorGain(effect, context);
          break;
        case 'overload':
          this.applyOverload(effect, context);
          break;
        case 'restore':
          this.restoreResources(effect, context);
          break;
        case 'rawText':
          console.log(`Raw text effect (not implemented): ${effect.text}`);
          break;
        case 'heal':
          await this.healCharacter(effect, context);
          break;
        case 'draw':
          this.drawCard(effect, context);
          break;
        case 'drawOnHeal':
          this.drawOnHeal(effect, context);
          break;
        case 'healAtEndOfTurn':
          this.healAtEndOfTurn(effect, context);
          break;
        case 'playRandomConsumableFromLibrary':
          await this.playRandomConsumableFromLibrary(effect, context);
          break;
        case 'destroy':
          this.destroyMinion(effect, context);
          break;
        case 'returnToHand':
          await this.returnToHand(effect, context);
          break;
        case 'transform':
          this.transformCharacter(effect, context);
          break;
        case 'equip':
          this.equipItem(effect, context);
          break;
        case 'spellDamageNextSpell':
          this.spellDamageNextSpell(effect, context);
          break;
        case 'damageArmor':
          await this.dealDamage({ target: effect.target, amount: context.player.hero.data.armor }, context);
          break;
        case 'buffOnSurviveDamage':
          this.buffOnSurviveDamage(effect, context);
          break;
        case 'explosiveTrap':
          this.explosiveTrap(effect, context);
          break;
        case 'freezingTrap':
          this.freezingTrap(effect, context);
          break;
        case 'snakeTrap':
          this.snakeTrap(effect, context);
          break;
        case 'counterShot':
          this.counterShot(effect, context);
          break;
        case 'retaliationRunes':
          this.retaliationRunes(effect, context);
          break;
        case 'vengefulSpirit':
          this.vengefulSpirit(effect, context);
          break;
        case 'chooseOne':
          await this.handleChooseOne(effect, context);
          break;
        default:
          console.log(`Unknown effect type: ${effect.type}`);
      }
    }
  }

  async dealDamage(effect, context) {
    const { target, amount, freeze, beastBonus, comboAmount, usesSpellDamage } = effect;
    const { game, player, card, comboActive } = context;
    const opponent = player === game.player ? game.opponent : game.player;
      let dmgAmount = amount;
      if (comboActive && typeof comboAmount === 'number') {
        dmgAmount = comboAmount;
      }
      if (beastBonus) {
        const hasBeast = player.battlefield.cards.some(c => c.keywords?.includes('Beast'));
        if (hasBeast) dmgAmount += beastBonus;
      }
      // Apply spell damage bonuses when appropriate:
      // - For spells
      // - For explicit non-spell effects that opt-in via `usesSpellDamage`
      if (card?.type === 'spell' || usesSpellDamage) {
        const bonus = getSpellDamageBonus(player);
        dmgAmount = computeSpellDamage(dmgAmount, bonus);
      }

    let actualTargets = [];

    switch (target) {
      case 'any': {
        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ]);
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter(isTargetable);
        const candidates = [...enemy, ...friendly];
        const chosen = await game.promptTarget(candidates);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'character': {
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter(isTargetable);
        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ]);
        const candidates = [...friendly, ...enemy];
        const chosen = await game.promptTarget(candidates);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'upToThreeTargets': {
        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ]);
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter(isTargetable);
        const candidates = [...enemy, ...friendly];
        const chosen = new Set();
        for (let i = 0; i < 3; i++) {
          const pick = await game.promptTarget(
            candidates.filter(c => !chosen.has(c)),
            { allowNoMore: chosen.size > 0 }
          );
          if (pick === game.CANCEL) throw game.CANCEL;
          if (!pick) break;
          chosen.add(pick);
        }
        actualTargets.push(...chosen);
        break;
      }
      case 'allCharacters':
        actualTargets.push(player.hero);
        actualTargets.push(opponent.hero);
        actualTargets.push(...player.battlefield.cards.filter(c => c.type !== 'quest'));
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'allOtherCharacters': {
        // Same as allCharacters, but exclude the source card if present
        const source = context?.card || null;
        actualTargets.push(player.hero);
        actualTargets.push(opponent.hero);
        actualTargets.push(...player.battlefield.cards.filter(c => c.type !== 'quest'));
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        if (source) {
          actualTargets = actualTargets.filter(t => t !== source);
        }
        break;
      }
      case 'allEnemies':
        actualTargets.push(opponent.hero);
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'minion': {
        const enemy = selectTargets(
          opponent.battlefield.cards.filter(c => c.type !== 'quest')
        );
        const friendly = player.battlefield.cards
          .filter(c => c.type !== 'quest')
          .filter(isTargetable);
        const candidates = [...enemy, ...friendly];
        const chosen = await game.promptTarget(candidates);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'enemyHeroOrMinionWithoutTaunt': {
        const candidates = [
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => !c.keywords?.includes('Taunt') && c.type !== 'quest'),
        ].filter(isTargetable);
        const chosen = await game.promptTarget(candidates);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'selfHero':
        actualTargets.push(player.hero);
        break;
      default:
        console.warn(`Unknown damage target: ${target}`);
        return;
    }

    for (const t of actualTargets) {
      // Divine Shield absorbs one instance of damage (for shielded minions)
      if (t?.data?.divineShield) {
        t.data.divineShield = false;
        if (t?.keywords?.includes?.('Divine Shield')) {
          t.keywords = t.keywords.filter(k => k !== 'Divine Shield');
        }
        // Emit zero-damage event for consistency with combat events
        game.bus.emit('damageDealt', { player, source: card, amount: 0, target: t });
        continue;
      }
      let remaining = dmgAmount;
      if (t.data && typeof t.data.armor === 'number') {
        const current = t.data.armor;
        const a = Math.max(0, current);
        const use = Math.min(a, remaining);
        t.data.armor = a - use; // never negative
        remaining -= use;
      }
      if (remaining <= 0) continue;
      if (t.data && t.data.health != null) {
        t.data.health -= remaining;
        console.log(
          `${t.name} took ${remaining} damage from ${card?.name ?? 'an unknown source'}. Remaining health: ${t.data.health}`
        );
        if (t.data.health > 0 && freeze) freezeTarget(t, freeze);
        if (t.data.health <= 0) t.data.dead = true;
      } else if (t.health != null) {
        t.health -= remaining;
        console.log(
          `${t.name} took ${remaining} damage from ${card?.name ?? 'an unknown source'}. Remaining health: ${t.health}`
        );
        if (t.health > 0 && freeze) freezeTarget(t, freeze);
      }
      if (t.keywords?.includes?.('Stealth')) {
        t.keywords = t.keywords.filter(k => k !== 'Stealth');
      }
      game.bus.emit('damageDealt', { player, source: card, amount: remaining, target: t });
    }
    // Let UI reflect HP changes before removals
    if (game._uiRerender) {
      try { game._uiRerender(); } catch {}
    }
    await game.cleanupDeaths(player, player);
    await game.cleanupDeaths(opponent, player);
  }

  async summonUnit(effect, context) {
    const { unit, count } = effect;
    const { player, card, game } = context;

    for (let i = 0; i < count; i++) {
      const newUnit = new Card({
        name: unit.name,
        type: 'ally', // Summoned units are typically allies
        data: { attack: unit.attack, health: unit.health },
        keywords: unit.keywords,
        summonedBy: card
      });
      if (newUnit.keywords?.includes('Divine Shield')) {
        newUnit.data.divineShield = true;
      }
      // Track entry turn for Rush/Charge logic
      newUnit.data.enteredTurn = this.game?.turns?.turn || 0;
      // Summoning sickness applies unless the unit has Rush or Charge
      if (!(newUnit.keywords?.includes('Rush') || newUnit.keywords?.includes('Charge'))) {
        newUnit.data.attacked = true;
        newUnit.data.summoningSick = true;
      }
      player.battlefield.add(newUnit);
      console.log(`Summoned ${newUnit.name} to battlefield.`);
      game?.bus.emit('unitSummoned', { player, card: newUnit });

      // Execute any on-summon effects with the summoned unit as the source
      if (Array.isArray(effect.onSummoned) && effect.onSummoned.length > 0) {
        await this.execute(effect.onSummoned, { game, player, card: newUnit });
      }
    }
  }

  registerSummonBuff(effect, context) {
    const { keyword, attack = 0, health = 0 } = effect;
    const { game, player, card } = context;

    const applyBuff = (unit) => {
      const equipped = Array.isArray(player.hero.equipment) && player.hero.equipment.some(eq => {
        if (eq === card) return true;
        if (eq?.id && card?.id && eq.id === card.id) return true;
        if (eq?.name && card?.name && eq.name === card.name) return true;
        return false;
      });
      if (!equipped) return;
      if (!unit.keywords?.includes(keyword)) return;
      unit.data = unit.data || {};
      unit.data.attack = (unit.data.attack || 0) + attack;
      unit.data.health = (unit.data.health || 0) + health;
      if (typeof health === 'number' && health !== 0) {
        const prior = (unit.data.health || 0) - health;
        const baseMax = (typeof unit.data.maxHealth === 'number') ? unit.data.maxHealth : prior;
        unit.data.maxHealth = baseMax + health;
        // Clamp current health to new max if health buff was negative
        if (health < 0) unit.data.health = Math.max(0, Math.min(unit.data.health, unit.data.maxHealth));
      }
    };

    const onPlay = ({ player: evtPlayer, card: played }) => {
      if (evtPlayer !== player) return;
      if (played === card) return;
      if (played.type !== 'ally') return;
      applyBuff(played);
    };

    const onSummon = ({ player: evtPlayer, card: summoned }) => {
      if (evtPlayer !== player) return;
      applyBuff(summoned);
    };

    game.bus.on('cardPlayed', onPlay);
    game.bus.on('unitSummoned', onSummon);
  }

  async healCharacter(effect, context) {
    const { target, amount } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    let actualTargets = [];

    switch (target) {
      case 'character': {
        const friendly = [
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest')
        ].filter(isTargetable);

        // If it's the AI's turn, default to healing its own hero
        if (game.turns.activePlayer && game.turns.activePlayer !== game.player) {
          actualTargets.push(player.hero);
          break;
        }

        const enemy = selectTargets([
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest')
        ]);
        const candidates = [...friendly, ...enemy];
        const chosen = await game.promptTarget(candidates);
        if (chosen === game.CANCEL) throw game.CANCEL;
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'selfHero':
      default:
        actualTargets.push(player.hero);
        break;
    }

    for (const t of actualTargets) {
      // Determine max health with sensible fallbacks (heroes default to 30)
      const cur = t?.data?.health ?? t?.health;
      const max = (t?.data?.maxHealth ?? t?.maxHealth ?? (t?.type === 'hero' ? 30 : cur));
      if (t?.data && t.data.health != null) {
        t.data.health = Math.min(cur + amount, max);
        console.log(`${t.name} healed for ${amount}. Current health: ${t.data.health}`);
      } else if (t?.health != null) {
        t.health = Math.min(cur + amount, max);
        console.log(`${t.name} healed for ${amount}. Current health: ${t.health}`);
      }
      game.bus.emit('characterHealed', { player, target: t, amount, source: card });
    }
  }

  drawCard(effect, context) {
    const { count } = effect;
    const { game, player } = context;
    game.draw(player, count);
    console.log(`${player.name} drew ${count} card(s).`);
  }

  explosiveTrap(effect, context) {
    const { amount = 2 } = effect;
    const { game, player, card } = context;

    // Track an active secret on the owner's hero for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = { type: 'explosiveTrap' };
    secrets.push(token);
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}

    const handler = async ({ target }) => {
      if (target !== player.hero) return;
      off();
      // Remove the secret indicator when it triggers
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}
      await game.effects.dealDamage(
        { target: 'allCharacters', amount },
        { game, player, card }
      );
    };

    const off = game.bus.on('damageDealt', handler);
  }

  freezingTrap(effect, context) {
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    // Track an active secret on the owner's hero for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = { type: 'freezingTrap' };
    secrets.push(token);
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}

    const handler = ({ attacker }) => {
      // Trigger only when an enemy ally (not hero/equipment) declares an attack
      if (!attacker || attacker.type !== 'ally') return;
      // Ensure the attacker belongs to the opponent side at the moment of attack
      const isEnemy = opponent.battlefield.cards.includes(attacker);
      if (!isEnemy) return;

      // Cancel the attack via flag recognized by CombatSystem
      attacker.data = attacker.data || {};
      attacker.data.attackCancelled = true;

      // Return to owner's hand and increase cost by 2
      opponent.battlefield.moveTo(opponent.hand, attacker);
      attacker.cost = (attacker.cost || 0) + 2;
      game.bus.emit('cardReturned', { player, card: attacker });

      // Secret triggers once
      off();
      // Remove the secret indicator when it triggers
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}
    };

    const off = game.bus.on('attackDeclared', handler);
  }

  snakeTrap(effect, context) {
    const { game, player, card } = context;
    // Track an active secret on the owner's hero for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = { type: 'snakeTrap' };
    secrets.push(token);
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}

    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ attacker }) => {
      // Trigger on enemy attack declaration (target-agnostic, similar to Freezing Trap)
      if (!attacker) return;
      const isEnemy = opponent.battlefield.cards.includes(attacker) || attacker === opponent.hero;
      if (!isEnemy) return;
      off();
      // Remove the secret indicator when it triggers
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}

      // Summon three 1/1 Snakes with Rush
      const summon = {
        type: 'summon',
        unit: { name: 'Snake', attack: 1, health: 1, keywords: ['Rush'] },
        count: 3,
      };
      await game.effects.summonUnit(summon, { game, player, card });
    };

    const off = game.bus.on('attackDeclared', handler);
  }

  counterShot(effect, context) {
    // Marker-only; actual counter resolution happens in Game.playFromHand
    const { game, player, card } = context;
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    secrets.push({ type: 'counterShot' });
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}
  }

  retaliationRunes(effect, context) {
    const { game, player, card } = context;
    const amount = typeof effect.amount === 'number' ? effect.amount : 2;
    // Track secret for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = { type: 'retaliationRunes' };
    secrets.push(token);
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}

    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ player: srcOwner, source, target }) => {
      // Trigger only when a friendly character (hero or ally) takes damage from the opponent
      const isFriendlyTarget = (target === player.hero) || player.battlefield.cards.includes(target);
      const fromOpponent = srcOwner === opponent;
      if (!isFriendlyTarget || !fromOpponent) return;

      off();
      // Remove secret indicator
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}

      // Only reflect if the source is a character on the battlefield
      if (source && (source === opponent.hero || opponent.battlefield.cards.includes(source))) {
        const prev = game.promptTarget;
        try {
          game.promptTarget = async () => source;
          await game.effects.dealDamage(
            { target: 'character', amount, usesSpellDamage: false },
            { game, player, card }
          );
        } finally {
          game.promptTarget = prev;
        }
      }
    };

    const off = game.bus.on('damageDealt', handler);
  }

  vengefulSpirit(effect, context) {
    const { game, player, card } = context;
    const amount = typeof effect.amount === 'number' ? effect.amount : 3;
    // Track secret for UI
    player.hero.data = player.hero.data || {};
    const secrets = (player.hero.data.secrets ||= []);
    const token = { type: 'vengefulSpirit' };
    secrets.push(token);
    try { game.bus.emit('secret:added', { player, card }); } catch {}
    try { game._uiRerender?.(); } catch {}

    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ player: killer, card: dead }) => {
      // Our ally died when the killer is the opponent side
      if (killer !== opponent) return;

      off();
      // Remove secret indicator
      const arr = player.hero?.data?.secrets;
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(token);
        if (idx >= 0) arr.splice(idx, 1);
      }
      try { game.bus.emit('secret:removed', { player, card }); } catch {}
      try { game._uiRerender?.(); } catch {}

      // Deal damage to a random enemy character (hero or ally)
      const enemies = [opponent.hero, ...opponent.battlefield.cards.filter(c => c.type !== 'quest')];
      const candidates = enemies.filter(Boolean);
      if (!candidates.length) return;
      const chosen = game.rng.pick(candidates);
      const prev = game.promptTarget;
      try {
        game.promptTarget = async () => chosen;
        await game.effects.dealDamage(
          { target: 'character', amount, usesSpellDamage: false },
          { game, player, card }
        );
      } finally {
        game.promptTarget = prev;
      }
    };

    const off = game.bus.on('allyDefeated', handler);
  }

  drawOnHeal(effect, context) {
    const { count = 1, threshold = 0 } = effect;
    const { game, player, card } = context;

    const handler = ({ player: healedPlayer, amount }) => {
      if (healedPlayer !== player) return;
      card.data = card.data || {};
      card.data.healedThisTurn = (card.data.healedThisTurn || 0) + amount;
      if (card.data.drawnThisTurn) return;
      if (card.data.healedThisTurn >= threshold) {
        game.draw(player, count);
        card.data.drawnThisTurn = true;
      }
    };

    const reset = ({ player: turnPlayer }) => {
      if (turnPlayer === player && card.data) {
        card.data.drawnThisTurn = false;
        card.data.healedThisTurn = 0;
      }
    };

    const offHeal = game.bus.on('characterHealed', handler);
    const offTurn = game.turns.bus.on('turn:start', reset);

    const remove = () => {
      offHeal();
      offTurn();
      offDeath();
      offReturn();
    };

    const offDeath = game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    });

    const offReturn = game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    });
  }

  healAtEndOfTurn(effect, context) {
    const { amount, target = 'randomCharacter' } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const handler = ({ player: turnPlayer }) => {
      if (turnPlayer === player) return;

      let candidates = [];
      switch (target) {
        case 'randomFriendlyCharacter':
          candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomEnemyCharacter':
          candidates = [
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomCharacter':
        default:
          candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
      }
      candidates = candidates
        .filter(t => (t.data && t.data.health != null) || t.health != null)
        .filter(isTargetable);

      if (!candidates.length) return;
      const targetChar = game.rng.pick(candidates);

      // Determine max health with sensible fallbacks (heroes default to 30)
      const cur = targetChar?.data?.health ?? targetChar?.health;
      const max = (targetChar?.data?.maxHealth ?? targetChar?.maxHealth ?? (targetChar?.type === 'hero' ? 30 : cur));
      if (targetChar?.data && targetChar.data.health != null) {
        targetChar.data.health = Math.min(cur + amount, max);
        console.log(`${targetChar.name} healed for ${amount}. Current health: ${targetChar.data.health}`);
      } else if (targetChar?.health != null) {
        targetChar.health = Math.min(cur + amount, max);
        console.log(`${targetChar.name} healed for ${amount}. Current health: ${targetChar.health}`);
      }

      const healedPlayer =
        targetChar === player.hero || player.battlefield.cards.includes(targetChar) ? player : opponent;
      game.bus.emit('characterHealed', { player: healedPlayer, target: targetChar, amount, source: card });
    };

    const offTurn = game.turns.bus.on('turn:start', handler);

    const remove = () => {
      offTurn();
      offDeath();
      offReturn();
    };

    const offDeath = game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    });

    const offReturn = game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    });
  }

  buffAtEndOfTurn(effect, context) {
    const { property = 'attack', amount = 1, target = 'randomFriendlyAlly' } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const handler = async ({ player: turnPlayer }) => {
      // Trigger at the start of the opponent's turn (end of controller's turn)
      if (turnPlayer === player) return;

      let candidates = [];
      switch (target) {
        case 'randomFriendlyAlly':
        case 'randomAlly':
        default:
          candidates = [
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomFriendlyCharacter':
          candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomEnemyCharacter':
          candidates = [
            opponent.hero,
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
        case 'randomEnemyAlly':
          candidates = [
            ...opponent.battlefield.cards.filter(c => c.type !== 'quest' && c.type !== 'equipment'),
          ];
          break;
      }

      candidates = candidates.filter(isTargetable);
      if (!candidates.length) return;

      const targetChar = game.rng.pick(candidates);
      await this.applyBuff(
        { type: 'buff', target: 'character', property, amount },
        { game, player, card },
        targetChar
      );
    };

    const offTurn = game.turns.bus.on('turn:start', handler);

    const remove = () => {
      offTurn();
      offDeath();
      offReturn();
    };

    const offDeath = game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    });

    const offReturn = game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    });
  }

  destroyMinion(effect, context) {
    const { target, condition } = effect;
    const { game, player } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    // Destroy a random enemy ally that meets the condition (relative to acting player)
    const targetMinions = opponent.battlefield.cards
      .filter(c => {
        if (c.type !== 'ally') return false;
        if (condition.type === 'attackLessThan') {
          return c.data.attack <= condition.amount;
        }
        return true;
      })
      .filter(isTargetable);

    if (targetMinions.length > 0) {
      const minionToDestroy = game.rng.pick(targetMinions);
      opponent.battlefield.moveTo(opponent.graveyard, minionToDestroy);
      console.log(`Destroyed ${minionToDestroy.name}.`);
    } else {
      console.log('No minion found to destroy.');
    }
  }

  async returnToHand(effect, context) {
    const { target, costIncrease = 0 } = effect;
    const { game, player } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    // Build candidate pool based on target; default to enemy allies
    let candidates = [];
    switch (target) {
      case 'enemyAlly':
      default:
        candidates = opponent.battlefield.cards.filter(c => c.type === 'ally');
        break;
      case 'ally':
        candidates = player.battlefield.cards.filter(c => c.type === 'ally');
        break;
      case 'anyAlly':
        candidates = [
          ...player.battlefield.cards.filter(c => c.type === 'ally'),
          ...opponent.battlefield.cards.filter(c => c.type === 'ally'),
        ];
        break;
    }

    // Respect targetability/taunt rules via selector
    candidates = selectTargets(candidates).filter(isTargetable);

    if (!candidates.length) {
      console.log('No valid ally found to return to hand.');
      return;
    }

    // Let the acting side pick a target (AI auto-picks via promptTarget)
    const chosen = await game.promptTarget(candidates);
    if (chosen === game.CANCEL) throw game.CANCEL;
    if (!chosen) return;

    const owner = opponent.battlefield.cards.includes(chosen) ? opponent
                : player.battlefield.cards.includes(chosen) ? player
                : null;
    if (!owner) return;

    owner.battlefield.moveTo(owner.hand, chosen);
    chosen.cost = (chosen.cost || 0) + costIncrease;
    console.log(`Returned ${chosen.name} to hand. New cost: ${chosen.cost}`);
    game.bus.emit('cardReturned', { player, card: chosen });
  }

  async buffBeast(effect, context) {
    const { attack = 0, health = 0, keywords = [], duration } = effect;
    const { game, player } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    const beasts = [
      ...player.battlefield.cards,
      ...opponent.battlefield.cards,
    ]
      .filter(c => c.keywords?.includes('Beast') && c.type !== 'quest')
      .filter(isTargetable);

    if (!beasts.length) return;

    const chosen = await game.promptTarget(beasts);
    if (chosen === game.CANCEL) throw game.CANCEL;
    if (!chosen) return;

    if (attack) {
      await this.applyBuff({ target: 'character', property: 'attack', amount: attack, duration }, context, chosen);
    }
    if (health) {
      await this.applyBuff({ target: 'character', property: 'health', amount: health, duration }, context, chosen);
    }

    for (const kw of keywords) {
      if (!chosen.keywords) chosen.keywords = [];
      if (!chosen.keywords.includes(kw)) {
        chosen.keywords.push(kw);
        if (duration === 'thisTurn') {
          const revertEffect = { revert: () => { chosen.keywords = chosen.keywords.filter(k => k !== kw); } };
          this.temporaryEffects.push(revertEffect);
        }
      }
    }
  }

  transformCharacter(effect, context) {
    const { target, into, duration } = effect;
    const { game, player } = context;

    let pool = player.battlefield.cards
      .filter(c => c.type !== 'quest')
      .filter(isTargetable);
    if (target === 'randomAlly') {
      pool = pool.filter(c => c.type === 'ally' || c.summonedBy);
    }

    if (pool.length > 0) {
      const allyToTransform = game.rng.pick(pool);
      const originalData = { ...allyToTransform.data };
      const originalKeywords = [...(allyToTransform.keywords || [])];
      const originalName = allyToTransform.name; // Store original name

      allyToTransform.name = into.name;
      allyToTransform.data.attack = into.attack;
      allyToTransform.data.health = into.health;
      allyToTransform.data.maxHealth = into.health;
      allyToTransform.keywords = into.keywords;

      if (duration === 'endOfTurn') {
        const revertEffect = {
          revert: () => {
            allyToTransform.name = originalName; // Revert name
            allyToTransform.data.attack = originalData.attack;
            allyToTransform.data.health = originalData.health;
            if (typeof originalData.maxHealth === 'number') {
              allyToTransform.data.maxHealth = originalData.maxHealth;
            } else {
              allyToTransform.data.maxHealth = originalData.health;
            }
            allyToTransform.keywords = originalKeywords;
          }
        };
        this.temporaryEffects.push(revertEffect);
      }
      console.log(`Transformed ${allyToTransform.name} into a ${into.name}.`);
    } else {
      console.log('No valid ally found to transform.');
    }
  }

  async playRandomConsumableFromLibrary(effect, context) {
    const { player, game } = context;
    const consumables = player.library.cards.filter(c => c.type === 'consumable');
    if (!consumables.length) return;
    const card = game.rng.pick(consumables);
    player.library.removeById(card.id);
    player.hand.add(card);
    const originalCost = card.cost || 0;
    card.cost = 0;
    await game.playFromHand(player, card.id);
    card.cost = originalCost;
  }

  registerDefaults() {
    // Remove the old regex-based registration
    // this.register(/Give your hero and allies \+(\d+) ATK this turn/, (game, context, match) => { ... });
  }

  cleanupTemporaryEffects() {
    for (const effect of this.temporaryEffects) {
      effect.revert();
    }
    this.temporaryEffects = [];
    console.log('Cleaned up temporary effects.');
  }

  async applyBuff(effect, context, forcedTarget = null) {
    const { target, property, amount, duration } = effect;
    const { player, game } = context;
    const opponent = player === game.player ? game.opponent : game.player;

    let actualTargets = [];

    switch (target) {
      case 'allies':
        actualTargets.push(player.hero);
        actualTargets.push(...player.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'hero':
        actualTargets.push(player.hero);
        break;
      case 'character': {
        if (forcedTarget) {
          actualTargets.push(forcedTarget);
        } else {
          // Allow enemy targets when this is a debuff (negative amount)
          const isDebuff = typeof amount === 'number' && amount < 0;
          let candidates = [
            player.hero,
            ...player.battlefield.cards.filter(c => c.type !== 'quest')
          ].filter(isTargetable);
          if (isDebuff) {
            const enemy = selectTargets([
              opponent.hero,
              ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
            ]);
            candidates = [...candidates, ...enemy];
          }
          const chosen = await game.promptTarget(candidates);
          if (chosen) actualTargets.push(chosen);
        }
        break;
      }
      default:
        console.warn(`Unknown buff target: ${target}`);
        return;
    }

    for (const t of actualTargets) {
      const scheduleRevert = (revertFn) => {
        if (!duration) return;
        if (duration === 'thisTurn') {
          this.temporaryEffects.push({ revert: revertFn });
        } else if (duration === 'untilYourNextTurn') {
          const handler = ({ player: turnPlayer }) => {
            if (turnPlayer !== player) return;
            try {
              revertFn();
            } finally {
              off();
            }
          };
          const off = game.turns.bus.on('turn:start', handler);
        }
      };

      if (duration === 'thisTurn' || duration === 'untilYourNextTurn') {
        const revertEffect = () => {
          if (property === 'attack') {
            if (t.data && t.data.attack != null) t.data.attack -= amount;
            else if (t.attack != null) t.attack -= amount; // For hero
          } else if (property === 'health') {
            const current = (t?.data?.health ?? t?.health);
            const hadPositive = typeof current === 'number' && current > 0;
            if (t.data && t.data.health != null) {
              if (typeof t.data.maxHealth === 'number') {
                if (amount >= 0) {
                  // Temporary health buff expiring: lower max, clamp current, never drop below 1 if it was alive
                  t.data.maxHealth -= amount;
                  if (t.data.maxHealth < 0) t.data.maxHealth = 0;
                  t.data.health = Math.min(t.data.health, t.data.maxHealth);
                  if (hadPositive && t.data.health < 1 && t.data.maxHealth >= 1) t.data.health = 1;
                } else {
                  // Temporary health debuff expiring: restore
                  t.data.maxHealth -= amount; // amount is negative -> increases max
                  if (t.data.maxHealth < 0) t.data.maxHealth = 0;
                  t.data.health = Math.min(t.data.health - amount, t.data.maxHealth);
                }
              } else {
                // No tracked maxHealth; fall back to prior behavior with safety for positive buffs
                if (amount >= 0) {
                  if (hadPositive && (t.data.health - amount) < 1) t.data.health = 1;
                  else t.data.health -= amount;
                } else {
                  t.data.health -= amount;
                }
                if (t.data.health < 0) t.data.health = 0;
              }
            } else if (t.health != null) {
              if (typeof t.maxHealth === 'number') {
                if (amount >= 0) {
                  t.maxHealth -= amount;
                  if (t.maxHealth < 0) t.maxHealth = 0;
                  t.health = Math.min(t.health, t.maxHealth);
                  if (hadPositive && t.health < 1 && t.maxHealth >= 1) t.health = 1;
                } else {
                  t.maxHealth -= amount; // amount negative -> increases max
                  if (t.maxHealth < 0) t.maxHealth = 0;
                  t.health = Math.min(t.health - amount, t.maxHealth);
                }
              } else {
                if (amount >= 0) {
                  if (hadPositive && (t.health - amount) < 1) t.health = 1;
                  else t.health -= amount;
                } else {
                  t.health -= amount;
                }
                if (t.health < 0) t.health = 0;
              }
            }
          } else if (property === 'armor') {
            if (t.data && t.data.armor != null) {
              t.data.armor -= amount;
              if (t.data.armor < 0) t.data.armor = 0;
            } else if (t.armor != null) {
              t.armor -= amount; // For hero
              if (t.armor < 0) t.armor = 0;
            }
          } else if (property === 'spellDamage') {
            if (t.data && typeof t.data.spellDamage === 'number') {
              t.data.spellDamage -= amount;
              if (t.data.spellDamage < 0) t.data.spellDamage = 0;
            }
          }
        };
        scheduleRevert(revertEffect);
      }

      if (property === 'attack') {
        if (t.data && t.data.attack != null) t.data.attack += amount;
        else if (t.attack != null) t.attack += amount; // For hero
      } else if (property === 'health') {
        if (t.data && t.data.health != null) {
          t.data.health += amount;
          if (typeof amount === 'number' && amount !== 0) {
            const prior = (t.data.health ?? 0) - amount;
            const baseMax = (typeof t.data.maxHealth === 'number') ? t.data.maxHealth : prior;
            t.data.maxHealth = baseMax + amount;
            if (amount < 0) t.data.health = Math.max(0, Math.min(t.data.health, t.data.maxHealth));
          }
        } else if (t.health != null) {
          t.health += amount; // For hero/non-card
          if (typeof amount === 'number' && amount !== 0) {
            const prior = (t.health ?? 0) - amount;
            const baseMax = (typeof t.maxHealth === 'number') ? t.maxHealth : prior;
            t.maxHealth = baseMax + amount;
            if (amount < 0) t.health = Math.max(0, Math.min(t.health, t.maxHealth));
          }
        }
      } else if (property === 'armor') {
        if (t.data && t.data.armor != null) {
          t.data.armor += amount;
          if (t.data.armor < 0) t.data.armor = 0;
        } else if (t.armor != null) {
          t.armor += amount; // For hero
          if (t.armor < 0) t.armor = 0;
        }
        if (amount > 0) {
          let p = null;
          if (t === player.hero) p = player;
          else if (t === opponent.hero) p = opponent;
          if (p) {
            p.armorGainedThisTurn = (p.armorGainedThisTurn || 0) + amount;
            game.bus.emit('armorGained', { player: p, amount, source: context.card });
          }
        }
      } else if (property === 'spellDamage') {
        if (!t.data) t.data = {};
        t.data.spellDamage = (t.data.spellDamage || 0) + amount;
      }
      console.log(`Applied +${amount} ${property} to ${t.name}.`);
    }
  }

  buffOnArmorGain(effect, context) {
    const { attack = 0, health = 0 } = effect;
    const { game, player, card } = context;

    const apply = () => {
      card.data = card.data || {};
      if (attack) card.data.attack = (card.data.attack || 0) + attack;
      if (health) {
        card.data.health = (card.data.health || 0) + health;
        const prior = (card.data.health || 0) - health;
        const baseMax = (typeof card.data.maxHealth === 'number') ? card.data.maxHealth : prior;
        card.data.maxHealth = baseMax + health;
        if (health < 0) card.data.health = Math.max(0, Math.min(card.data.health, card.data.maxHealth));
      }
    };

    const handler = ({ player: armorPlayer }) => {
      if (armorPlayer !== player) return;
      apply();
    };

    const offArmor = game.bus.on('armorGained', handler);

    const remove = () => {
      offArmor();
      offDeath();
      offReturn();
    };

    const offDeath = game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    });

    const offReturn = game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    });
  }

  buffOnSurviveDamage(effect, context) {
    const { attack = 0, health = 0 } = effect;
    const { game, card } = context;

    const apply = () => {
      card.data = card.data || {};
      if (attack) card.data.attack = (card.data.attack || 0) + attack;
      if (health) {
        card.data.health = (card.data.health || 0) + health;
        const prior = (card.data.health || 0) - health;
        const baseMax = (typeof card.data.maxHealth === 'number') ? card.data.maxHealth : prior;
        card.data.maxHealth = baseMax + health;
        if (health < 0) card.data.health = Math.max(0, Math.min(card.data.health, card.data.maxHealth));
      }
    };

    const handler = ({ target }) => {
      if (target !== card) return;
      if (card.data?.health > 0) apply();
    };

    const offDamage = game.bus.on('damageDealt', handler);

    const remove = () => {
      offDamage();
      offDeath();
      offReturn();
    };

    const offDeath = game.bus.on('allyDefeated', ({ card: dead }) => {
      if (dead === card) remove();
    });

    const offReturn = game.bus.on('cardReturned', ({ card: returned }) => {
      if (returned === card) remove();
    });
  }

  equipItem(effect, context) {
    const { item } = effect;
    const { player, game } = context;
    const eq = new Equipment(item);
    player.equip(eq);
    if (eq.armor) {
      player.armorGainedThisTurn = (player.armorGainedThisTurn || 0) + eq.armor;
      game.bus.emit('armorGained', { player, amount: eq.armor, source: eq });
    }
    console.log(`Equipped ${eq.name}.`);
  }

  spellDamageNextSpell(effect, context) {
    const { amount = 1, eachTurn = false } = effect;
    const { player } = context;
    player.hero.data.nextSpellDamageBonus = { amount, used: false, eachTurn };
  }

  applyOverload(effect, context) {
    const { amount } = effect;
    const { player, game } = context;
    game.resources.addOverloadNextTurn(player, amount);
    console.log(`Applied ${amount} overload to ${player.name}.`);
  }

  async handleChooseOne(effect, context) {
    const { game, player } = context;
    const options = effect.options || [];

    // If it's the AI's turn, auto-pick a sensible option without prompting the player.
    const isAITurn = !!game.turns.activePlayer && game.turns.activePlayer !== game.player;
    if (isAITurn) {
      // Simple heuristic: prefer healing if any friendly is injured; otherwise prefer damage; else first option.
      const isHealOption = (opt) => Array.isArray(opt?.effects) && opt.effects.some(e => e.type === 'heal');
      const isDamageOption = (opt) => Array.isArray(opt?.effects) && opt.effects.some(e => e.type === 'damage');

      // Check if any friendly character is injured
      const chars = [player.hero, ...player.battlefield.cards];
      const friendlyInjured = chars.some(c => {
        const cur = c?.data?.health ?? c?.health;
        const max = c?.data?.maxHealth ?? c?.maxHealth ?? cur;
        return typeof cur === 'number' && cur < max;
      });

      let chosen = null;
      if (friendlyInjured) {
        chosen = options.find(isHealOption) || null;
      }
      if (!chosen) {
        chosen = options.find(isDamageOption) || null;
      }
      if (!chosen) {
        chosen = options[0] || null;
      }
      if (chosen?.effects) {
        await this.execute(chosen.effects, context);
      }
      return;
    }

    // Player's turn: show prompt UI and execute the selected option.
    const optionTexts = options.map(o => o.text) || [];
    const idx = await game.promptOption(optionTexts);
    // If the user cancels, abort the card play entirely
    if (idx === game.CANCEL) throw game.CANCEL;
    const chosen = options[idx] || options[0];
    if (chosen?.effects) {
      await this.execute(chosen.effects, context);
    }
  }

  restoreResources(effect, context) {
    const { amount, requiresSpent } = effect;
    const { game, player } = context;
    if (requiresSpent) {
      const used = game.resources.available(player) - game.resources.pool(player);
      if (used < requiresSpent) return;
    }
    game.resources.restore(player, amount);
  }
}

export default EffectSystem;
