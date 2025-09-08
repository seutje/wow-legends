export class BasicAI {
  constructor({ resourceSystem }) {
    this.resources = resourceSystem;
  }

  takeTurn(player) {
    // Very naive: place a resource if possible, then attempt to play cheapest affordable card
    this.resources.startTurn(player);
    // End immediately (placeholder)
    return true;
  }
}

export default BasicAI;

