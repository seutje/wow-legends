import Deck from './deck.js';
import Zone from './zone.js';
import Hand from './hand.js';
import Hero from './hero.js';
import Equipment from './equipment.js';
import { replaceEquipment } from '../utils/equipment.js';

export class Player {
  constructor({ id, name = 'Player', hero = null } = {}) {
    this.id = id || `player-${Math.random().toString(36).slice(2, 8)}`;
    this.name = name;
    this.hero = hero || new Hero({ name: `${name}'s Hero` });
    // Link ownership for downstream systems (e.g., combat side effects)
    if (this.hero) this.hero.owner = this;
    this.health = 30;
    this.armor = 0;
    this.resources = 0; // legacy numeric; use resourceZone + pool
    this.status = {};
    this.cardsPlayedThisTurn = 0;
    this.armorGainedThisTurn = 0;
    this.log = [];

    this.library = new Deck('library');
    this.hand = new Hand('hand');
    this.resourcesZone = new Zone('resources');
    this.graveyard = new Zone('graveyard');
    this.battlefield = new Zone('battlefield');
    this.removed = new Zone('removed');
  }

  equip(item) {
    const eq = item instanceof Equipment ? item : new Equipment(item);
    replaceEquipment(this, eq);
    return eq;
  }
}

export default Player;
