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
          // Implement damage logic
          console.log(`Dealing ${effect.amount} damage to ${effect.target}`);
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