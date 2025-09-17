import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Snake Trap does not trigger when the hero is attacked', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);
  g.resources._pool.set(g.opponent, 10);

  const trapData = g.allCards.find(c => c.id === 'spell-snake-trap');
  const trap = new Card(trapData);
  g.player.hand.add(trap);
  await g.playFromHand(g.player, trap.id);

  const attacker = new Card({
    name: 'Test Attacker',
    type: 'ally',
    cost: 2,
    data: { attack: 2, health: 2 },
    keywords: [],
  });
  g.opponent.battlefield.add(attacker);

  const initialSecrets = (g.player.hero.data.secrets || []).length;
  const result = await g.attack(g.opponent, attacker.id);

  expect(result).toBe(true);
  const snakes = g.player.battlefield.cards.filter(c => c.name === 'Snake');
  expect(snakes.length).toBe(0);
  expect((g.player.hero.data.secrets || []).length).toBe(initialSecrets);
});

test('Snake Trap triggers when a friendly ally is attacked', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);
  g.resources._pool.set(g.opponent, 10);

  const trapData = g.allCards.find(c => c.id === 'spell-snake-trap');
  const trap = new Card(trapData);
  g.player.hand.add(trap);
  await g.playFromHand(g.player, trap.id);

  const defender = new Card({
    name: 'Friendly Ally',
    type: 'ally',
    cost: 2,
    data: { attack: 1, health: 3 },
    keywords: [],
  });
  g.player.battlefield.add(defender);

  const attacker = new Card({
    name: 'Enemy Attacker',
    type: 'ally',
    cost: 2,
    data: { attack: 1, health: 2 },
    keywords: [],
  });
  g.opponent.battlefield.add(attacker);

  const result = await g.attack(g.opponent, attacker.id, defender.id);

  expect(result).toBe(true);
  const snakes = g.player.battlefield.cards.filter(c => c.name === 'Snake');
  expect(snakes.length).toBe(3);
  expect(g.player.hero.data.secrets || []).toHaveLength(0);
});

