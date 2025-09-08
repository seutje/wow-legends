import Card from '../entities/card.js';

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
          console.log(`Raw text effect: ${effect.text}`);
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
      } else if (t.health != null) { // For hero
        t.health -= amount;
        console.log(`${t.name} took ${amount} damage. Remaining health: ${t.health}`);
      }
    }
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
    game.resources.addOverloadNextTurn(player, amount);
    console.log(`Applied ${amount} overload to ${player.name}.`);
  }
}

export default EffectSystem;