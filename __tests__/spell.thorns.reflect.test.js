import { describe, test, expect } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Thorns reflect effect', () => {
  test('Thorns grants temporary reflect that triggers retaliation', async () => {
    const g = new Game();
    await g.setupMatch();

    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);
    g.resources._pool.set(g.opponent, 10);

    const defender = new Card({ id: 'defender', name: 'Target', type: 'ally', data: { attack: 2, health: 3 }, keywords: [] });
    const attacker = new Card({ id: 'attacker', name: 'Enemy', type: 'ally', data: { attack: 3, health: 6 }, keywords: [] });

    g.player.battlefield.add(defender);
    g.opponent.battlefield.add(attacker);

    g.addCardToHand('spell-thorns');
    g.promptTarget = async () => defender;
    await g.playFromHand(g.player, 'spell-thorns');

    expect(defender.keywords).toContain('Reflect');

    // Opponent turn start - effect should persist
    g.turns.bus.emit('turn:start', { player: g.opponent });
    expect(defender.keywords).toContain('Reflect');

    const combat = g.combat;
    expect(combat.declareAttacker(attacker)).toBe(true);
    combat.assignBlocker(attacker.id, defender);
    const events = combat.resolve();

    const reflectEvents = events.filter(ev => ev.source === defender && ev.target === attacker && ev.isReflect);
    expect(reflectEvents).toHaveLength(1);
    expect(reflectEvents[0].amount).toBe(5);
    expect(attacker.data.health).toBe(0);
    expect(attacker.data.dead).toBe(true);
    expect(defender.data.health).toBe(0);
    expect(defender.data.dead).toBe(true);

    // Start of player's next turn removes temporary keyword
    g.turns.bus.emit('turn:start', { player: g.player });
    expect(defender.keywords).not.toContain('Reflect');
  });

  test('Thorns on divine shield ally does not reflect when damage is absorbed', async () => {
    const g = new Game();
    await g.setupMatch();

    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.resources._pool.set(g.player, 10);
    g.resources._pool.set(g.opponent, 10);

    const crusaderData = g.allCards.find(c => c.id === 'ally-scarlet-crusader');
    expect(crusaderData).toBeTruthy();
    const crusader = new Card(crusaderData);
    crusader.owner = g.player;
    crusader.data.divineShield = true;

    const attacker = new Card({
      id: 'attacker',
      name: 'Enemy',
      type: 'ally',
      data: { attack: 3, health: 5 },
      keywords: [],
    });
    attacker.owner = g.opponent;

    g.player.battlefield.add(crusader);
    g.opponent.battlefield.add(attacker);

    g.addCardToHand('spell-thorns');
    g.promptTarget = async () => crusader;
    await g.playFromHand(g.player, 'spell-thorns');

    expect(crusader.keywords).toContain('Reflect');
    expect(crusader.data.divineShield).toBe(true);

    const combat = g.combat;
    expect(combat.declareAttacker(attacker)).toBe(true);
    combat.assignBlocker(attacker.id, crusader);
    const events = combat.resolve();

    const reflectEvents = events.filter(ev => ev.source === crusader && ev.isReflect);
    expect(reflectEvents).toHaveLength(0);
    expect(attacker.data.health).toBe(2);
    expect(crusader.data.health).toBe(1);
    expect(crusader.data.divineShield).toBe(false);
  });
});
