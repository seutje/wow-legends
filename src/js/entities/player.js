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
    this.resources = 0;
    this.status = {};

    this.library = new Deck('library');
    this.hand = new Hand('hand');
    this.graveyard = new Zone('graveyard');
    this.battlefield = new Zone('battlefield');
    this.removed = new Zone('removed');
  }
}

export default Player;

