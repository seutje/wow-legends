import Deck from './deck.js';
import Zone from './zone.js';
import Hand from './hand.js';
import Hero from './hero.js';
import Equipment from './equipment.js';

export class Player {
  constructor({ id, name = 'Player', hero = null } = {}) {
    this.id = id || `player-${Math.random().toString(36).slice(2, 8)}`;
    this.name = name;
    this.hero = hero || new Hero({ name: `${name}'s Hero` });
    this.health = 30;
    this.armor = 0;
    this.resources = 0; // legacy numeric; use resourceZone + pool
    this.status = {};
    this.cardsPlayedThisTurn = 0;

    this.library = new Deck('library');
    this.hand = new Hand('hand');
    this.resourcesZone = new Zone('resources');
    this.graveyard = new Zone('graveyard');
    this.battlefield = new Zone('battlefield');
    this.removed = new Zone('removed');
    this.quests = new Zone('quests');
  }

  equip(item) {
    const eq = item instanceof Equipment ? item : new Equipment(item);
    this.hero.equipment.push(eq);
    if (eq.armor) {
      this.hero.data.armor = (this.hero.data.armor || 0) + eq.armor;
    }
    return eq;
  }
}

export default Player;
