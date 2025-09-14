import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('canceling targeted spell prompt does not consume the card or mana', async () => {
  const g = new Game();
  await g.setupMatch();

  // Setup: clear zones and give resources
  g.player.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  // Add a known targeted spell (Lightning Bolt)
  g.addCardToHand('spell-lightning-bolt');
  const bolt = g.player.hand.cards.find(c => c.id === 'spell-lightning-bolt');

  const beforePool = g.resources.pool(g.player);
  const beforeHandSize = g.player.hand.cards.length;

  // Simulate cancel from the target prompt
  g.promptTarget = async () => g.CANCEL;

  const played = await g.playFromHand(g.player, bolt.id);

  expect(played).toBe(false);
  expect(g.resources.pool(g.player)).toBe(beforePool); // mana refunded
  expect(g.player.hand.cards.length).toBe(beforeHandSize); // card still in hand
});

test('canceling choose-one prompt does not consume the card or mana', async () => {
  const g = new Game();
  await g.setupMatch();

  // Use an ally with Choose One battlecry (Keeper of the Grove from cards-2)
  g.player.hand.cards = [];
  g.resources._pool.set(g.player, 10);

  const keeperData = g.allCards.find(c => c.id === 'ally-keeper-of-the-grove');
  const keeper = new Card(keeperData);
  g.player.hand.add(keeper);

  const beforePool = g.resources.pool(g.player);
  const beforeHandSize = g.player.hand.cards.length;

  // Simulate cancel from the choose-one prompt
  g.promptOption = async () => g.CANCEL;

  const played = await g.playFromHand(g.player, keeper.id);

  expect(played).toBe(false);
  expect(g.resources.pool(g.player)).toBe(beforePool);
  expect(g.player.hand.cards.length).toBe(beforeHandSize);
});

