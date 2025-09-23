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

test('Summoned units on the opponent turn track the previous turn entry', async () => {
  const g = new Game(null, { aiPlayers: [] });
  await g.setupMatch();

  g.player.battlefield.cards = [];
  g.turns.turn = 7;
  g.turns.setActivePlayer(g.opponent);

  await g.effects.summonUnit(
    { unit: { name: 'Specter', attack: 1, health: 1 }, count: 1 },
    { game: g, player: g.player, card: null }
  );

  const specter = g.player.battlefield.cards.at(-1);
  expect(specter.data.enteredTurn).toBe(6);
});

test('Snake Trap snakes can attack the hero on the following turn', async () => {
  const g = new Game(null, { aiPlayers: [] });
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
    name: 'Friendly Bait',
    type: 'ally',
    cost: 1,
    data: { attack: 0, health: 4 },
    keywords: [],
  });
  g.player.battlefield.add(defender);

  const attacker = new Card({
    name: 'Enemy Aggressor',
    type: 'ally',
    cost: 1,
    data: { attack: 1, health: 1 },
    keywords: [],
  });
  g.opponent.battlefield.add(attacker);

  g.turns.setActivePlayer(g.opponent);
  g.turns.current = 'Start';
  g.turns.startTurn();
  g.resources.startTurn(g.opponent);

  await g._runSimpleAITurn(g.opponent, g.player);
  await g._finalizeOpponentTurn();

  const snakes = g.player.battlefield.cards.filter(c => c.name === 'Snake');
  expect(snakes).toHaveLength(3);

  expect(snakes[0].data.enteredTurn).toBeLessThan(g.turns.turn);

  g.opponent.battlefield.cards = [];

  const result = await g.attack(g.player, snakes[0]);
  expect(result).toBe(true);
});

