export class BasicAI {
  constructor({ resourceSystem }) {
    this.resources = resourceSystem;
  }

  takeTurn(player) {
    // Very naive: place a resource if possible, then attempt to play cheapest affordable card
    this.resources.startTurn(player);
    // Place resource if any in hand
    if (player.hand.size() > 0 && this.resources.canPlaceResource(player)) {
      const first = player.hand.cards[0];
      this.resources.placeResource(player, first.id);
    }
    // End immediately (placeholder)
    return true;
  }
}

export default BasicAI;

