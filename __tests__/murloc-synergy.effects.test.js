import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Murloc synergy effects', () => {
  test('buffTribe buffs murlocs on both sides of the battlefield', async () => {
    const game = new Game();
    const player = game.player;
    const opponent = game.opponent;

    const friendlyMurloc = new Card({
      type: 'ally',
      name: 'Friendly Murloc',
      keywords: ['Murloc'],
      data: { attack: 2, health: 2 },
    });
    const friendlySoldier = new Card({
      type: 'ally',
      name: 'Footman',
      data: { attack: 3, health: 3 },
    });
    const enemyMurloc = new Card({
      type: 'ally',
      name: 'Enemy Murloc',
      keywords: ['Murloc'],
      data: { attack: 1, health: 3 },
    });

    player.battlefield.add(friendlyMurloc);
    player.battlefield.add(friendlySoldier);
    opponent.battlefield.add(enemyMurloc);

    const spell = new Card({ type: 'spell', name: 'Shoal Blessing' });

    await game.effects.execute(
      [
        {
          type: 'buffTribe',
          tribe: 'Murloc',
          attack: 1,
          health: 2,
        },
      ],
      { game, player, card: spell }
    );

    expect(friendlyMurloc.data.attack).toBe(3);
    expect(friendlyMurloc.data.health).toBe(4);
    expect(friendlyMurloc.data.maxHealth).toBe(4);
    expect(enemyMurloc.data.attack).toBe(2);
    expect(enemyMurloc.data.health).toBe(5);
    expect(enemyMurloc.data.maxHealth).toBe(5);
    expect(friendlySoldier.data.attack).toBe(3);
    expect(friendlySoldier.data.health).toBe(3);
  });

  test('buffTribe can include the source card before it enters play', async () => {
    const game = new Game();
    const player = game.player;

    const shieldbearer = new Card({
      type: 'ally',
      name: 'Shoal Shieldbearer',
      keywords: ['Murloc'],
      data: { attack: 2, health: 4 },
    });

    await game.effects.execute(
      [
        {
          type: 'buffTribe',
          tribe: 'Murloc',
          health: 2,
          includeSource: true,
        },
      ],
      { game, player, card: shieldbearer }
    );

    expect(shieldbearer.data.health).toBe(6);
    expect(shieldbearer.data.maxHealth).toBe(6);
  });

  test('gainStatsPerTribe counts murlocs on both battlefields', async () => {
    const game = new Game();
    const player = game.player;
    const opponent = game.opponent;

    const allyShoal = new Card({
      type: 'ally',
      name: 'Shoal Scout',
      keywords: ['Murloc'],
      data: { attack: 1, health: 1 },
    });
    const allyWarrior = new Card({
      type: 'ally',
      name: 'Shoal Warrior',
      keywords: ['Murloc'],
      data: { attack: 2, health: 2 },
    });
    const enemyShoal = new Card({
      type: 'ally',
      name: 'Enemy Shoal',
      keywords: ['Murloc'],
      data: { attack: 1, health: 2 },
    });

    player.battlefield.add(allyShoal);
    player.battlefield.add(allyWarrior);
    opponent.battlefield.add(enemyShoal);

    const tidecaller = new Card({
      type: 'ally',
      name: 'Deepfin Tidecaller',
      keywords: ['Murloc'],
      data: { attack: 2, health: 2 },
    });

    await game.effects.execute(
      [
        {
          type: 'gainStatsPerTribe',
          tribe: 'Murloc',
          attackPer: 1,
          healthPer: 1,
          excludeSource: true,
        },
      ],
      { game, player, card: tidecaller }
    );

    expect(tidecaller.data.attack).toBe(5);
    expect(tidecaller.data.health).toBe(5);
    expect(tidecaller.data.maxHealth).toBe(5);
    expect(allyShoal.data.attack).toBe(1);
    expect(enemyShoal.data.attack).toBe(1);
  });
});
