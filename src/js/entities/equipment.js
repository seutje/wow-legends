import { shortId } from '../utils/id.js';

export default class Equipment {
  constructor({ id, instanceId, name = 'Equipment', attack = 0, armor = 0, durability = 1 } = {}) {
    this.id = id || shortId('equip');
    this.instanceId = instanceId || shortId('equipinst');
    this.name = name;
    this.attack = attack;
    this.armor = armor;
    this.durability = durability;
  }
}

