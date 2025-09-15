import '../entities/types.js';
import { shortId } from '../utils/id.js';

/**
 * @typedef {import('./types.js').Card} Card
 * @typedef {import('./types.js').CardType} CardType
 */

export class CardEntity {
  /**
   * @param {Partial<Card> & { name: string, type: CardType }} props
   */
  constructor(props) {
    this.id = props.id || shortId('card');
    this.type = props.type;
    this.name = props.name;
    this.cost = props.cost ?? 0;
    // Copy common top-level stats for non-ally types (e.g., equipment)
    if (props.attack != null) this.attack = props.attack;
    if (props.durability != null) this.durability = props.durability;
    this.keywords = props.keywords ? Array.from(props.keywords) : [];
    this.data = props.data ? { ...props.data } : {};
    // Ensure allies and other characters have a stable maxHealth baseline
    if (typeof this.data.health === 'number' && this.data.maxHealth == null) {
      this.data.maxHealth = this.data.health;
    }
    this.text = props.text || '';
    this.effects = props.effects || [];
    this.combo = props.combo || [];
    this.summonedBy = props.summonedBy || null;
    this.requirement = props.requirement || null;
    this.reward = props.reward || [];
  }
}

export default CardEntity;
