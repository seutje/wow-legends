import Card from '../entities/card.js';

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

  execute(cardEffects, context) {
    for (const effect of cardEffects) {
      switch (effect.type) {
        case 'damage':
          this.dealDamage(effect, context);
          break;
        case 'summon':
          this.summonUnit(effect, context);
          break;
        case 'buff':
          this.applyBuff(effect, context);
          break;
        case 'overload':
          this.applyOverload(effect, context);
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
        case 'destroy':
          this.destroyMinion(effect, context);
          break;
        case 'returnToHand':
          this.returnToHand(effect, context);
          break;
        case 'transform':
          this.transformCharacter(effect, context);
          break;
        default:
          console.log(`Unknown effect type: ${effect.type}`);
      }
    }
  }

  dealDamage(effect, context) {
    const { target, amount } = effect;
    const { game, player, card } = context;

    let actualTargets = [];

    switch (target) {
      case 'any':
        // This requires target selection from the player.
        // For now, I'll just target the opponent's hero.
        actualTargets.push(game.opponent.hero);
        break;
      case 'allCharacters':
        actualTargets.push(player.hero);
        actualTargets.push(game.opponent.hero);
        actualTargets.push(...player.battlefield.cards);
        actualTargets.push(...game.opponent.battlefield.cards);
        break;
      case 'allEnemies':
        actualTargets.push(game.opponent.hero);
        actualTargets.push(...game.opponent.battlefield.cards);
        break;
      case 'minion':
        // This requires target selection from the player.
        // For now, I'll just target a random enemy minion if available, otherwise opponent hero.
        if (game.opponent.battlefield.cards.length > 0) {
          actualTargets.push(game.rng.pick(game.opponent.battlefield.cards));
        } else {
          actualTargets.push(game.opponent.hero);
        }
        break;
      case 'enemyHeroOrMinionWithoutTaunt':
        // This requires target selection from the player.
        // For now, I'll just target opponent hero.
        actualTargets.push(game.opponent.hero);
        break;
      default:
        console.warn(`Unknown damage target: ${target}`);
        return;
    }

    for (const t of actualTargets) {
      if (t.data && t.data.health != null) {
        t.data.health -= amount;
        console.log(`${t.name} took ${amount} damage. Remaining health: ${t.data.health}`);
        if (t.data.health <= 0) t.data.dead = true;
      } else if (t.health != null) { // For hero
        t.health -= amount;
        console.log(`${t.name} took ${amount} damage. Remaining health: ${t.health}`);
      }
    }

    game.cleanupDeaths(player);
    game.cleanupDeaths(game.opponent);
  }

  summonUnit(effect, context) {
    const { unit, count } = effect;
    const { player } = context;

    for (let i = 0; i < count; i++) {
      const newUnit = new Card({
        name: unit.name,
        type: 'ally', // Summoned units are typically allies
        data: { attack: unit.attack, health: unit.health },
        keywords: unit.keywords
      });
      player.battlefield.add(newUnit);
      console.log(`Summoned ${newUnit.name} to battlefield.`);
    }
  }

  healCharacter(effect, context) {
    const { target, amount } = effect;
    const { game, player } = context;

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
    }
  }

  drawCard(effect, context) {
    const { count } = effect;
    const { game, player } = context;
    game.draw(player, count);
    console.log(`${player.name} drew ${count} card(s).`);
  }

  destroyMinion(effect, context) {
    const { target, condition } = effect;
    const { game, player } = context;

    // For now, destroy a random enemy minion that meets the condition
    const targetMinions = game.opponent.battlefield.cards.filter(c => {
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
    if (game.opponent.battlefield.cards.length > 0) {
      const allyToReturn = game.rng.pick(game.opponent.battlefield.cards);
      game.opponent.battlefield.moveTo(game.opponent.hand, allyToReturn.id);
      allyToReturn.cost += costIncrease; // Increase cost
      console.log(`Returned ${allyToReturn.name} to hand. New cost: ${allyToReturn.cost}`);
    } else {
      console.log('No enemy ally found to return to hand.');
    }
  }

  transformCharacter(effect, context) {
    const { target, into, duration } = effect;
    const { game, player } = context;

    // For now, transform a random player ally
    if (player.battlefield.cards.length > 0) {
      const allyToTransform = game.rng.pick(player.battlefield.cards);
      const originalData = { ...allyToTransform.data };
      const originalKeywords = [...allyToTransform.keywords];
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
      console.log('No player ally found to transform.');
    }
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

  applyBuff(effect, context) {
    const { target, property, amount, duration } = effect;
    const { player, game } = context;

    let actualTargets = [];

    switch (target) {
      case 'allies':
        actualTargets.push(player.hero);
        actualTargets.push(...player.battlefield.cards);
        break;
      case 'hero':
        actualTargets.push(player.hero);
        break;
      case 'character':
        // This requires target selection from the player.
        // For now, I'll just target the player's hero.
        actualTargets.push(player.hero);
        break;
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

  applyOverload(effect, context) {
    const { amount } = effect;
    const { player, game } = context;
    console.log('applyOverload: game object', game);
    console.log('applyOverload: game.resources', game.resources);
    game.resources.addOverloadNextTurn(player, amount);
    console.log(`Applied ${amount} overload to ${player.name}.`);
  }
}

export default EffectSystem;