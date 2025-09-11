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

    expect(player.hero.data.health).toBe(7);
    expect(opponent.hero.data.health).toBe(8);
    expect(ally.data.health).toBe(1);
    expect(enemy.data.health).toBe(1);

    await game.effects.dealDamage({ target: 'selfHero', amount: 1 }, { game, player, card: null });
    await new Promise(r => setTimeout(r, 0));

    expect(player.hero.data.health).toBe(6);
    expect(ally.data.health).toBe(1);
  });
});

