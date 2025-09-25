import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('EffectSystem', () => {
  test('dead allies move from battlefield to graveyard', async () => {
    const game = new Game();
    const player = game.player;
    const ally = new Card({ type: 'ally', name: 'A', data: { attack: 0, health: 1 } });
    player.battlefield.add(ally);

    await game.effects.dealDamage(
      { target: 'allCharacters', amount: 1 },
      { game, player, card: null }
    );

    expect(player.battlefield.cards.length).toBe(0);
    expect(player.graveyard.cards).toContain(ally);
  });

  test('dealDamage prompts for target and applies damage', async () => {
    const game = new Game();
    const player = game.player;
    const enemy = new Card({ type: 'ally', name: 'E', data: { attack: 0, health: 3 } });
    game.opponent.battlefield.add(enemy);

    const promptSpy = jest.fn(async () => enemy);
    game.promptTarget = promptSpy;

    await game.effects.dealDamage(
      { target: 'any', amount: 2 },
      { game, player, card: null }
    );

    expect(promptSpy).toHaveBeenCalled();
    expect(enemy.data.health).toBe(1);
  });

  test('armor absorbs damage before health', async () => {
    const game = new Game();
    const player = game.player;
    player.hero.data.armor = 3;
    player.hero.data.health = 10;
    game.promptTarget = async () => player.hero;

    await game.effects.dealDamage(
      { target: 'character', amount: 2 },
      { game, player, card: null }
    );

    expect(player.hero.data.armor).toBe(1);
    expect(player.hero.data.health).toBe(10);

    await game.effects.dealDamage(
      { target: 'character', amount: 2 },
      { game, player, card: null }
    );

    expect(player.hero.data.armor).toBe(0);
    expect(player.hero.data.health).toBe(9);
  });

  test('dealDamage logs source of damage', async () => {
    const game = new Game();
    const player = game.player;
    const enemy = new Card({ type: 'ally', name: 'E', data: { attack: 0, health: 5 } });
    game.opponent.battlefield.add(enemy);
    game.promptTarget = async () => enemy;
    const source = new Card({ type: 'spell', name: 'Fireball' });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await game.effects.dealDamage(
      { target: 'character', amount: 3 },
      { game, player, card: source }
    );

    expect(logSpy).toHaveBeenCalledWith(
      `${enemy.name} took 3 damage from ${source.name}. Remaining health: ${enemy.data.health}`
    );
    logSpy.mockRestore();
  });

  test('buff can increase armor', async () => {
    const game = new Game();
    const player = game.player;
    await game.effects.applyBuff(
      { target: 'hero', property: 'armor', amount: 2 },
      { game, player }
    );
    expect(player.hero.data.armor).toBe(2);
  });

  test('explosive trap triggers on hero damage', async () => {
    const game = new Game();
    const player = game.player;
    const opponent = game.opponent;

    player.hero.data.health = 10;
    opponent.hero.data.health = 10;

    const ally = new Card({ type: 'ally', name: 'Ally', data: { attack: 0, health: 3 } });
    const enemy = new Card({ type: 'ally', name: 'Enemy', data: { attack: 0, health: 3 } });
    player.battlefield.add(ally);
    opponent.battlefield.add(enemy);

    const secret = new Card({ type: 'spell', name: 'Explosive Trap', effects: [{ type: 'explosiveTrap', amount: 2 }] });
    await game.effects.execute(secret.effects, { game, player, card: secret });

    expect(ally.data.health).toBe(3);
    expect(enemy.data.health).toBe(3);

    await game.effects.dealDamage({ target: 'selfHero', amount: 1 }, { game, player, card: null });
    await new Promise(r => setTimeout(r, 0));

    expect(player.log).toContain('1: Secret triggered: Explosive Trap');
    expect(opponent.log).toContain('1: Enemy secret triggered: Explosive Trap');

    expect(player.hero.data.health).toBe(7);
    expect(opponent.hero.data.health).toBe(8);
    expect(ally.data.health).toBe(1);
    expect(enemy.data.health).toBe(1);

    await game.effects.dealDamage({ target: 'selfHero', amount: 1 }, { game, player, card: null });
    await new Promise(r => setTimeout(r, 0));

    expect(player.hero.data.health).toBe(6);
    expect(ally.data.health).toBe(1);
  });

  test('battlecry damage triggers explosive trap after ally enters play', async () => {
    const game = new Game();
    const player = game.player;
    const opponent = game.opponent;

    player.hero.data.health = 30;
    opponent.hero.data.health = 30;

    const secret = new Card({ type: 'spell', name: 'Explosive Trap', effects: [{ type: 'explosiveTrap', amount: 2 }] });
    await game.effects.execute(secret.effects, { game, player: opponent, card: secret });

    const battlecry = new Card({
      type: 'ally',
      name: 'Flamecaller Adept',
      cost: 0,
      data: { attack: 1, health: 3 },
      keywords: ['Battlecry'],
      effects: [{ type: 'damage', target: 'any', amount: 1 }],
    });

    player.hand.add(battlecry);
    game.promptTarget = jest.fn(async () => opponent.hero);

    await game.playFromHand(player, battlecry.id);
    await new Promise(r => setTimeout(r, 0));

    expect(opponent.hero.data.health).toBe(27);
    expect(player.hero.data.health).toBe(28);
    expect(player.battlefield.cards).toContain(battlecry);
    expect(battlecry.data.health).toBe(1);
  });

  test('area damage hits stealth allies and removes stealth', async () => {
    const game = new Game();
    const stealth = new Card({ type: 'ally', name: 'S', data: { attack: 1, health: 2 }, keywords: ['Stealth'] });
    game.player.battlefield.add(stealth);
    await game.effects.dealDamage(
      { target: 'allEnemies', amount: 1 },
      { game, player: game.opponent, card: null }
    );
    expect(stealth.data.health).toBe(1);
    expect(stealth.keywords).not.toContain('Stealth');
  });

  test('buffing attack and health prompts for one target', async () => {
    const game = new Game();
    const player = game.player;
    const ally = new Card({ type: 'ally', name: 'Ally', data: { attack: 1, health: 1 } });
    player.battlefield.add(ally);

    const promptSpy = jest.fn(async () => ally);
    game.promptTarget = promptSpy;

    const effects = [
      { type: 'buff', target: 'character', property: 'attack', amount: 4 },
      { type: 'buff', target: 'character', property: 'health', amount: 4 },
    ];

    await game.effects.execute(effects, { game, player, card: null });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(ally.data.attack).toBe(5);
    expect(ally.data.health).toBe(5);
  });
});

