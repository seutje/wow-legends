export class EffectSystem {
  constructor(game) {
    this.game = game;
  }

  execute(effectText, context) {
    console.log(`Executing effect: ${effectText}`, context);
    // Placeholder for effect execution logic
  }
}

export default EffectSystem;
