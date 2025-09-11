import Card from '../entities/card.js';
import Equipment from '../entities/equipment.js';
import { freezeTarget, getSpellDamageBonus, computeSpellDamage } from './keywords.js';

export class EffectSystem {
  constructor(game) {
    this.game = game;
    console.log('EffectSystem constructor: game object', this.game);
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
    for (const effect of cardEffects) {
      switch (effect.type) {
        case 'damage':
          await this.dealDamage(effect, context);
          break;
        case 'summon':
          this.summonUnit(effect, context);
          break;
        case 'summonBuff':
          this.registerSummonBuff(effect, context);
          break;
        case 'buff':
          await this.applyBuff(effect, context);
          break;
        case 'overload':
          this.applyOverload(effect, context);
          break;
        case 'restore':
          this.restoreResources(effect, context);
          break;
        case 'rawText':
          console.warn(`Raw text effect (not implemented): ${effect.text}`);
          break;
        case 'heal':
          this.healCharacter(effect, context);
          break;
        case 'draw':
          this.drawCard(effect, context);
          break;
        case 'drawOnHeal':
          this.drawOnHeal(effect, context);
          break;
        case 'playRandomConsumableFromLibrary':
          await this.playRandomConsumableFromLibrary(effect, context);
          break;
        case 'destroy':
          this.destroyMinion(effect, context);
          break;
        case 'returnToHand':
          this.returnToHand(effect, context);
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
        case 'chooseOne':
          await this.handleChooseOne(effect, context);
          break;
        default:
          console.log(`Unknown effect type: ${effect.type}`);
      }
    }
  }

  async dealDamage(effect, context) {
    const { target, amount, freeze, beastBonus } = effect;
    const { game, player, card } = context;
    const opponent = player === game.player ? game.opponent : game.player;
      let dmgAmount = amount;
      if (beastBonus) {
        const hasBeast = player.battlefield.cards.some(c => c.keywords?.includes('Beast'));
        if (hasBeast) dmgAmount += beastBonus;
      }
      if (card?.type === 'spell') {
        const bonus = getSpellDamageBonus(player);
        if (bonus) dmgAmount = computeSpellDamage(amount, bonus);
      }

    let actualTargets = [];

    switch (target) {
      case 'any': {
        const candidates = [
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest'),
        ];
        const chosen = await game.promptTarget(candidates);
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'character': {
        const candidates = [
          player.hero,
          opponent.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest'),
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ];
        const chosen = await game.promptTarget(candidates);
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'upToThreeTargets': {
        const candidates = [
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
          player.hero,
          ...player.battlefield.cards.filter(c => c.type !== 'quest'),
        ];
        const chosen = new Set();
        for (let i = 0; i < 3; i++) {
          const pick = await game.promptTarget(
            candidates.filter(c => !chosen.has(c)),
            { allowNoMore: chosen.size > 0 }
          );
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
      case 'allEnemies':
        actualTargets.push(opponent.hero);
        actualTargets.push(...opponent.battlefield.cards.filter(c => c.type !== 'quest'));
        break;
      case 'minion': {
        const candidates = [
          ...player.battlefield.cards.filter(c => c.type !== 'quest'),
          ...opponent.battlefield.cards.filter(c => c.type !== 'quest'),
        ];
        const chosen = await game.promptTarget(candidates);
        if (chosen) actualTargets.push(chosen);
        break;
      }
      case 'enemyHeroOrMinionWithoutTaunt': {
        const candidates = [
          opponent.hero,
          ...opponent.battlefield.cards.filter(c => !c.keywords?.includes('Taunt') && c.type !== 'quest'),
        ];
        const chosen = await game.promptTarget(candidates);
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
      let remaining = dmgAmount;
      if (t.data && typeof t.data.armor === 'number') {
        const use = Math.min(t.data.armor, remaining);
        t.data.armor -= use;
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
      game.bus.emit('damageDealt', { player, source: card, amount: remaining, target: t });
    }

    await game.cleanupDeaths(player, player);
    await game.cleanupDeaths(opponent, player);
  }

  summonUnit(effect, context) {
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
      if (!newUnit.keywords?.includes('Rush')) {
        newUnit.data.attacked = true;
      }
      player.battlefield.add(newUnit);
      console.log(`Summoned ${newUnit.name} to battlefield.`);
      game?.bus.emit('unitSummoned', { player, card: newUnit });
    }
  }

  registerSummonBuff(effect, context) {
    const { keyword, attack = 0, health = 0 } = effect;
    const { game, player, card } = context;

    const applyBuff = (unit) => {
      if (!player.hero.equipment.includes(card)) return;
      if (!unit.keywords?.includes(keyword)) return;
      unit.data = unit.data || {};
      unit.data.attack = (unit.data.attack || 0) + attack;
      unit.data.health = (unit.data.health || 0) + health;
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

  healCharacter(effect, context) {
    const { target, amount } = effect;
    const { game, player, card } = context;

    let actualTargets = [];
    // For now, always target player's hero
    actualTargets.push(player.hero);

    for (const t of actualTargets) {
      if (t.data && t.data.health != null) {
        t.data.health = Math.min(t.data.health + amount, t.data.maxHealth || t.data.health);
        console.log(`${t.name} healed for ${amount}. Current health: ${t.data.health}`);
      } else if (t.health != null) { // For hero
        t.health = Math.min(t.health + amount, t.maxHealth || t.health);
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

  drawOnHeal(effect, context) {
    const { count = 1 } = effect;
    const { game, player, card } = context;

    const handler = ({ player: healedPlayer }) => {
      if (healedPlayer !== player) return;
      card.data = card.data || {};
      if (card.data.drawnThisTurn) return;
      game.draw(player, count);
      card.data.drawnThisTurn = true;
    };

    const reset = ({ player: turnPlayer }) => {
      if (turnPlayer === player && card.data) card.data.drawnThisTurn = false;
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

  destroyMinion(effect, context) {
    const { target, condition } = effect;
    const { game, player } = context;

    // For now, destroy a random enemy minion that meets the condition
    const targetMinions = game.opponent.battlefield.cards.filter(c => {
      if (c.type === 'quest') return false;
      if (condition.type === 'attackLessThan') {
        return c.data.attack <= condition.amount;
      }
      return true;
    });

    if (targetMinions.length > 0) {
      const minionToDestroy = game.rng.pick(targetMinions);
      game.opponent.battlefield.moveTo(game.opponent.graveyard, minionToDestroy.id);
      console.log(`Destroyed ${minionToDestroy.name}.`);
    } else {
      console.log('No minion found to destroy.');
    }
  }

  returnToHand(effect, context) {
    const { target, costIncrease } = effect;
    const { game, player } = context;

    // For now, return a random enemy ally to hand
    const opponents = game.opponent.battlefield.cards.filter(c => c.type !== 'quest');
    if (opponents.length > 0) {
      const allyToReturn = game.rng.pick(opponents);
      game.opponent.battlefield.moveTo(game.opponent.hand, allyToReturn.id);
      allyToReturn.cost += costIncrease; // Increase cost
      console.log(`Returned ${allyToReturn.name} to hand. New cost: ${allyToReturn.cost}`);
      game.bus.emit('cardReturned', { player, card: allyToReturn });
    } else {
      console.log('No enemy ally found to return to hand.');
    }
  }

  transformCharacter(effect, context) {
    const { target, into, duration } = effect;
    const { game, player } = context;

    let pool = player.battlefield.cards.filter(c => c.type !== 'quest');
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
      allyToTransform.keywords = into.keywords;

      if (duration === 'endOfTurn') {
        const revertEffect = {
          revert: () => {
            allyToTransform.name = originalName; // Revert name
            allyToTransform.data.attack = originalData.attack;
            allyToTransform.data.health = originalData.health;
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

  async applyBuff(effect, context) {
    const { target, property, amount, duration } = effect;
    const { player, game } = context;

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
        const candidates = [player.hero, ...player.battlefield.cards.filter(c => c.type !== 'quest')];
        const chosen = await game.promptTarget(candidates);
        if (chosen) actualTargets.push(chosen);
        break;
      }
      default:
        console.warn(`Unknown buff target: ${target}`);
        return;
    }

    for (const t of actualTargets) {
      if (duration === 'thisTurn') {
        const revertEffect = {
          revert: () => {
            if (property === 'attack') {
              if (t.data && t.data.attack != null) t.data.attack -= amount;
              else if (t.attack != null) t.attack -= amount; // For hero
            } else if (property === 'health') {
              if (t.data && t.data.health != null) t.data.health -= amount;
              else if (t.health != null) t.health -= amount; // For hero
            } else if (property === 'armor') {
              if (t.data && t.data.armor != null) t.data.armor -= amount;
              else if (t.armor != null) t.armor -= amount; // For hero
            }
          }
        };
        this.temporaryEffects.push(revertEffect);
      }

      if (property === 'attack') {
        if (t.data && t.data.attack != null) t.data.attack += amount;
        else if (t.attack != null) t.attack += amount; // For hero
      } else if (property === 'health') {
        if (t.data && t.data.health != null) t.data.health += amount;
        else if (t.health != null) t.health += amount; // For hero
      } else if (property === 'armor') {
        if (t.data && t.data.armor != null) t.data.armor += amount;
        else if (t.armor != null) t.armor += amount; // For hero
      }
      console.log(`Applied +${amount} ${property} to ${t.name}.`);
    }
  }

  equipItem(effect, context) {
    const { item } = effect;
    const { player } = context;
    const eq = new Equipment(item);
    player.equip(eq);
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
    console.log('applyOverload: game object', game);
    console.log('applyOverload: game.resources', game.resources);
    game.resources.addOverloadNextTurn(player, amount);
    console.log(`Applied ${amount} overload to ${player.name}.`);
  }

  async handleChooseOne(effect, context) {
    const { game } = context;
    const optionTexts = effect.options?.map(o => o.text) || [];
    const idx = await game.promptOption(optionTexts);
    const chosen = effect.options?.[idx] || effect.options?.[0];
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
