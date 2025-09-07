import Deck from './deck.js';
import Zone from './zone.js';
import Hand from './hand.js';

export class Player {
  constructor({ id, name = 'Player', hero = null } = {}) {
    this.id = id || `player-${Math.random().toString(36).slice(2, 8)}`;
    this.name = name;
    this.hero = hero; // Hero reference or object
    this.health = 30;
    this.armor = 0;
    this.resources = 0; // legacy numeric; use resourceZone + pool
    this.status = {};

    this.library = new Deck('library');
    this.hand = new Hand('hand');
    this.resourcesZone = new Zone('resources');
    this.graveyard = new Zone('graveyard');
    this.battlefield = new Zone('battlefield');
    this.removed = new Zone('removed');
  }
}

export default Player;
