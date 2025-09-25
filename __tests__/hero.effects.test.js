import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

describe('hero effects', () => {
  test('passive effect triggers at start of each turn', async () => {
    const g = new Game();
    g.player.hero = new Hero({ passive: [{ type: 'buff', target: 'hero', property: 'armor', amount: 1 }] });
    g.turns.setActivePlayer(g.player);
    g.turns.startTurn();
    await Promise.resolve();
    expect(g.player.hero.data.armor).toBe(1);

    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    expect(g.player.hero.data.armor).toBe(2);
  });

  test('active effect can be used once per turn', async () => {
    const g = new Game();
    g.player.hero = new Hero({ active: [{ type: 'buff', target: 'hero', property: 'armor', amount: 1 }] });
    g.turns.setActivePlayer(g.player);
    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    g.turns.turn = 2;
    g.resources.startTurn(g.player);

    await g.useHeroPower(g.player);
    expect(g.player.hero.data.armor).toBe(1);
    await g.useHeroPower(g.player);
    expect(g.player.hero.data.armor).toBe(1);

    g.turns.turn++;
    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    g.resources.startTurn(g.player);
    await g.useHeroPower(g.player);
    expect(g.player.hero.data.armor).toBe(2);
  });

  test("Anduin passive discounts first heal from spells and hero power", async () => {
    const g = new Game();
    g.player.hero = new Hero({
      passive: [
        { type: 'firstHealCostReduction', amount: 1 },
      ],
      active: [
        { type: 'heal', target: 'character', amount: 2 },
      ],
    });

    const healSpellA = new Card({
      id: 'test-heal-a',
      type: 'spell',
      cost: 2,
      effects: [
        { type: 'heal', target: 'character', amount: 3 },
      ],
    });

    const healSpellB = new Card({
      id: 'test-heal-b',
      type: 'spell',
      cost: 2,
      effects: [
        { type: 'heal', target: 'character', amount: 3 },
      ],
    });

    g.player.hand.add(healSpellA);
    g.player.hand.add(healSpellB);

    g.turns.setActivePlayer(g.player);
    g.turns.turn = 2;
    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    g.resources.startTurn(g.player);

    g.resources.pay(g.player, 1);
    expect(g.resources.pool(g.player)).toBe(1);
    expect(g.canPlay(g.player, healSpellA)).toBe(true);

    await expect(g.playFromHand(g.player, healSpellA)).resolves.toBe(true);
    expect(g.resources.pool(g.player)).toBe(0);

    g.resources.restore(g.player, 2);
    expect(g.resources.pool(g.player)).toBe(2);

    await expect(g.useHeroPower(g.player)).resolves.toBe(true);
    expect(g.resources.pool(g.player)).toBe(0);

    g.turns.turn = 3;
    g.turns.bus.emit('turn:start', { player: g.player });
    await Promise.resolve();
    g.resources.startTurn(g.player);

    g.resources.pay(g.player, 2);
    expect(g.resources.pool(g.player)).toBe(1);

    await expect(g.useHeroPower(g.player)).resolves.toBe(true);
    expect(g.resources.pool(g.player)).toBe(0);

    g.resources.restore(g.player, 1);
    expect(g.canPlay(g.player, healSpellB)).toBe(false);
  });

  test("Valeera passive discounts only the first combo card each turn", async () => {
    const g = new Game();
    g.player.hero = new Hero({
      passive: [
        { type: 'firstKeywordCostReduction', keyword: 'Combo', amount: 1, minimum: 1 },
      ],
    });

    const comboSpellA = new Card({
      id: 'test-combo-a',
      type: 'spell',
      cost: 3,
      keywords: ['Combo'],
      effects: [],
    });
    const comboSpellB = new Card({
      id: 'test-combo-b',
      type: 'spell',
      cost: 3,
      keywords: ['Combo'],
      effects: [],
    });

    g.player.hand.add(comboSpellA);
    g.player.hand.add(comboSpellB);

    g.turns.setActivePlayer(g.player);
    g.turns.turn = 2;
    g.turns.bus.emit('turn:start', { player: g.player });
    g.resources.startTurn(g.player);

    expect(g.resources.pool(g.player)).toBe(2);
    expect(g.canPlay(g.player, comboSpellA)).toBe(true);

    await expect(g.playFromHand(g.player, comboSpellA)).resolves.toBe(true);
    expect(g.resources.pool(g.player)).toBe(0);

    g.resources.restore(g.player, 2);
    expect(g.resources.pool(g.player)).toBe(2);
    expect(g.canPlay(g.player, comboSpellB)).toBe(false);

    g.turns.turn = 3;
    g.turns.bus.emit('turn:start', { player: g.player });
    g.resources.startTurn(g.player);
    g.resources.pay(g.player, 1); // leave 2 resources available

    expect(g.resources.pool(g.player)).toBe(2);
    expect(g.canPlay(g.player, comboSpellB)).toBe(true);
  });
});

