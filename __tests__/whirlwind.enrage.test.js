import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('Whirlwind enrage interaction', () => {
  test('friendly allies damaged by Whirlwind gain +1 attack', async () => {
    const g = new Game();
    await g.setupMatch();

    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.opponent.hand.cards = [];
    g.player.hero.data.armor = 0;
    g.opponent.hero.data.armor = 0;
    g.resources._pool.set(g.player, 10);

    const friendly = new Card({
      name: 'Friendly',
      type: 'ally',
      data: { attack: 2, health: 3 },
      keywords: [],
    });
    const enemy = new Card({
      name: 'Enemy',
      type: 'ally',
      data: { attack: 4, health: 4 },
      keywords: [],
    });
    g.player.battlefield.add(friendly);
    g.opponent.battlefield.add(enemy);

    g.addCardToHand('spell-whirlwind');
    const whirlwind = g.player.hand.cards.find(c => c.id === 'spell-whirlwind');
    expect(whirlwind).toBeTruthy();

    const initialFriendlyAttack = friendly.data.attack;
    const initialEnemyAttack = enemy.data.attack;

    await g.playFromHand(g.player, whirlwind.id);

    expect(friendly.data.health).toBe(2);
    expect(friendly.data.attack).toBe(initialFriendlyAttack + 1);
    expect(enemy.data.health).toBe(3);
    expect(enemy.data.attack).toBe(initialEnemyAttack);
  });

  test('Divine Shield prevents the Whirlwind attack buff', async () => {
    const g = new Game();
    await g.setupMatch();

    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];
    g.player.hero.data.armor = 0;
    g.opponent.hero.data.armor = 0;
    g.resources._pool.set(g.player, 10);

    const shielded = new Card({
      name: 'Shielded Ally',
      type: 'ally',
      data: { attack: 3, health: 3, divineShield: true },
      keywords: ['Divine Shield'],
    });
    g.player.battlefield.add(shielded);

    g.addCardToHand('spell-whirlwind');
    const whirlwind = g.player.hand.cards.find(c => c.id === 'spell-whirlwind');
    expect(whirlwind).toBeTruthy();

    const initialAttack = shielded.data.attack;

    await g.playFromHand(g.player, whirlwind.id);

    expect(shielded.data.divineShield).toBe(false);
    expect(shielded.data.health).toBe(3);
    expect(shielded.data.attack).toBe(initialAttack);
  });
});
