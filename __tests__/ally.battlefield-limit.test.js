import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

function createAlly(name, { attack = 1, health = 1, keywords = [], deathrattle = null } = {}) {
  const card = new Card({
    type: 'ally',
    name,
    cost: 0,
    data: { attack, health },
    keywords,
  });
  if (deathrattle) {
    card.deathrattle = deathrattle;
  }
  return card;
}

describe('battlefield ally limit', () => {
  test('playing a sixth ally destroys the oldest and triggers its deathrattle', async () => {
    const game = new Game();
    game.player.hero = new Hero({ name: 'Player Hero', data: { health: 30 } });
    game.opponent.hero = new Hero({ name: 'Opponent Hero', data: { health: 30 } });

    const defeated = [];
    game.bus.on('allyDefeated', (payload) => defeated.push(payload));

    const oldest = createAlly('Veteran', {
      keywords: ['Deathrattle'],
      deathrattle: [{ type: 'damage', target: 'allEnemies', amount: 2 }],
    });
    game.player.battlefield.add(oldest);
    for (let i = 0; i < 4; i++) {
      game.player.battlefield.add(createAlly(`Ally ${i + 2}`));
    }

    const newAlly = createAlly('Reinforcement');
    game.player.hand.add(newAlly);

    await game.playFromHand(game.player, newAlly.id);

    expect(game.player.battlefield.cards).toHaveLength(5);
    expect(game.player.battlefield.cards).toContain(newAlly);
    expect(game.player.battlefield.cards).not.toContain(oldest);
    expect(game.player.graveyard.cards).toContain(oldest);
    expect(game.opponent.hero.data.health).toBe(28);
    expect(defeated.some(({ card, player }) => card === oldest && player === game.player)).toBe(true);
  });

  test('summoning beyond the limit removes the oldest allies first', async () => {
    const game = new Game();
    game.player.hero = new Hero({ name: 'Player Hero', data: { health: 30 } });
    game.opponent.hero = new Hero({ name: 'Opponent Hero', data: { health: 30 } });

    const existing = [];
    for (let i = 0; i < 5; i++) {
      const ally = createAlly(`Board Ally ${i + 1}`);
      game.player.battlefield.add(ally);
      existing.push(ally);
    }

    const spell = new Card({
      type: 'spell',
      name: 'Reinforcements',
      cost: 0,
      effects: [{
        type: 'summon',
        unit: { name: 'Token', attack: 1, health: 1 },
        count: 2,
      }],
    });
    game.player.hand.add(spell);

    await game.playFromHand(game.player, spell.id);

    const tokenCount = game.player.battlefield.cards.filter((c) => c.name === 'Token').length;
    expect(tokenCount).toBe(2);
    expect(game.player.battlefield.cards).toHaveLength(5);
    expect(game.player.battlefield.cards).not.toContain(existing[0]);
    expect(game.player.battlefield.cards).not.toContain(existing[1]);
    expect(game.player.graveyard.cards).toEqual(expect.arrayContaining([existing[0], existing[1]]));
  });
});
