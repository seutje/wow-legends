import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

describe('summoning sickness and rush', () => {
  test('played ally without Rush cannot attack immediately', async () => {
    const g = new Game();
    g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
    g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
    const ally = new Card({ type: 'ally', name: 'Footman', cost: 0, data: { attack: 1, health: 1 }, keywords: [] });
    g.player.hand.add(ally);
    await g.playFromHand(g.player, ally.id);
    expect(await g.attack(g.player, ally.id)).toBe(false);
  });

  test('played ally with Rush can attack immediately', async () => {
    const g = new Game();
    g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
    g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
    const ally = new Card({ type: 'ally', name: 'Raider', cost: 0, data: { attack: 1, health: 1 }, keywords: ['Rush'] });
    g.player.hand.add(ally);
    await g.playFromHand(g.player, ally.id);
    const initial = g.opponent.hero.data.health;
    expect(await g.attack(g.player, ally.id)).toBe(true);
    expect(g.opponent.hero.data.health).toBe(initial - 1);
  });

  test('summoned ally without Rush cannot attack immediately', async () => {
    const g = new Game();
    g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
    g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
    const spell = new Card({ type: 'spell', name: 'Summon', cost: 0, effects: [{ type: 'summon', unit: { name: 'Token', attack: 1, health: 1, keywords: [] }, count: 1 }] });
    g.player.hand.add(spell);
    await g.playFromHand(g.player, spell.id);
    const summoned = g.player.battlefield.cards.find(c => c.name === 'Token');
    expect(await g.attack(g.player, summoned.id)).toBe(false);
  });

  test('summoned ally with Rush can attack immediately', async () => {
    const g = new Game();
    g.player.hero = new Hero({ name: 'Hero', data: { health: 10 } });
    g.opponent.hero = new Hero({ name: 'Enemy', data: { health: 10 } });
    const spell = new Card({ type: 'spell', name: 'Summon', cost: 0, effects: [{ type: 'summon', unit: { name: 'Rusher', attack: 1, health: 1, keywords: ['Rush'] }, count: 1 }] });
    g.player.hand.add(spell);
    await g.playFromHand(g.player, spell.id);
    const summoned = g.player.battlefield.cards.find(c => c.name === 'Rusher');
    const initial = g.opponent.hero.data.health;
    expect(await g.attack(g.player, summoned.id)).toBe(true);
    expect(g.opponent.hero.data.health).toBe(initial - 1);
  });
});

