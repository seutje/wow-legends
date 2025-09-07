import { shortId } from '../utils/id.js';

export default class Hero {
  constructor({ id, name = 'Hero', attack = 0, health = 30, armor = 0 } = {}) {
    this.id = id || shortId('hero');
    this.name = name;
    this.data = { attack, health, armor };
    this.keywords = [];
    this.equipment = [];
  }

  totalAttack() {
    const base = this.data.attack || 0;
    const bonus = this.equipment.reduce((s, e) => s + (e.attack || 0), 0);
    return base + bonus;
  }
}

