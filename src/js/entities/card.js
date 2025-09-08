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
    this.keywords = props.keywords ? Array.from(props.keywords) : [];
    this.data = props.data ? { ...props.data } : {};
    this.text = props.text || '';
    this.effects = props.effects || [];
  }
}

export default CardEntity;

