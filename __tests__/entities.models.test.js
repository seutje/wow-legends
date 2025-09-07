import Card from '../src/js/entities/card.js';
import Deck from '../src/js/entities/deck.js';
import Hand from '../src/js/entities/hand.js';
import Zone from '../src/js/entities/zone.js';
import Player from '../src/js/entities/player.js';
import { validateCardDev } from '../src/js/entities/validate.js';

describe('Entities', () => {
  test('Card creation and serialization', () => {
    const c = new Card({ type: 'ally', name: 'Footman', cost: 1, data: { attack: 1, health: 2 } });
    const json = JSON.stringify(c);
    expect(json).toMatch(/Footman/);
    expect(c.type).toBe('ally');
  });

  test('Zones and movement', () => {
    const deck = new Deck();
    const hand = new Hand();
    const gy = new Zone('graveyard');
    const c1 = new Card({ type: 'ally', name: 'A' });
    const c2 = new Card({ type: 'ally', name: 'B' });
    deck.add(c1); deck.add(c2);
    expect(deck.size()).toBe(2);
    const [drawn] = deck.draw(1);
    expect(drawn).toBeTruthy();
    hand.add(drawn);
    expect(hand.size()).toBe(1);
    hand.moveTo(gy, drawn.id);
    expect(hand.size()).toBe(0);
    expect(gy.size()).toBe(1);
  });

  test('Player scaffolds zones', () => {
    const p = new Player({ name: 'Alice' });
    expect(p.name).toBe('Alice');
    expect(p.library).toBeInstanceOf(Deck);
    expect(p.hand).toBeInstanceOf(Hand);
  });

  test('Validator fails on bad card', () => {
    const bad = { id: 'x', type: 'nope', name: '' };
    expect(() => validateCardDev(bad)).toThrow();
  });
});

