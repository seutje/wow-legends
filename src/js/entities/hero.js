import { shortId } from '../utils/id.js';

export default class Hero {
  constructor({ id, name = 'Hero', data = {}, attack = 0, health = 30, armor = 0, keywords = [], text = '', effects = [] } = {}) {
    this.id = id || shortId('hero');
    this.name = name;
    if (data) {
      attack = data.attack ?? attack;
      health = data.health ?? health;
      armor = data.armor ?? armor;
    }
    this.data = { attack, health, armor };
    this.keywords = keywords;
    this.effects = effects;
    this.text = text;
    this.equipment = [];
  }

  totalAttack() {
    const base = this.data.attack || 0;
    const bonus = this.equipment.reduce((s, e) => s + (e.attack || 0), 0);
    return base + bonus;
  }
}

