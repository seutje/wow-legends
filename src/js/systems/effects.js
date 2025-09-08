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
          // Implement summon logic
          console.log(`Summoning ${effect.count} x ${effect.unit.name}`);
          break;
        case 'buff':
          // Implement buff logic
          console.log(`Buffing ${effect.target} with +${effect.amount} ${effect.property}`);
          // This is where the Savage Roar logic will go
          if (effect.target === 'allies' && effect.property === 'attack') {
            const amount = effect.amount;
            const heroEffect = {
              revert: () => { context.player.hero.data.attack -= amount; }
            };
            this.temporaryEffects.push(heroEffect);
            context.player.hero.data.attack += amount;

            for (const ally of context.player.battlefield.cards) {
              const allyEffect = {
                revert: () => { ally.data.attack -= amount; }
              };
              this.temporaryEffects.push(allyEffect);
              ally.data.attack += amount;
            }
            console.log(`Gave +${amount} ATK to hero and allies.`);
          }
          break;
        case 'overload':
          // Implement overload logic
          console.log(`Applying ${effect.amount} overload`);
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
}

export default EffectSystem;