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

  register(regex, handler) {
    this.effectRegistry.set(regex, handler);
  }

  execute(effectText, context) {
    for (const [regex, handler] of this.effectRegistry.entries()) {
      const match = effectText.match(regex);
      if (match) {
        handler(this.game, context, match);
        return;
      }
    }
    console.log(`No handler found for effect: ${effectText}`);
  }

  registerDefaults() {
    this.register(/Give your hero and allies \+(\d+) ATK this turn/, (game, context, match) => {
      const amount = parseInt(match[1], 10);
      
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
    });
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