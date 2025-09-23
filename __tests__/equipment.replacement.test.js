import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

/**
 * Equipping a new item should destroy the previous equipment for both players.
 */
test('equipping a new item destroys previous equipment', async () => {
  const game = new Game();
  await game.setupMatch();

  game.player.hand.cards = [];
  game.player.battlefield.cards = [];
  game.player.graveyard.cards = [];
  game.player.log = [];
  game.resources._pool.set(game.player, 10);

  const first = new Card({
    id: 'equipment-test-first',
    name: 'Test Blade',
    type: 'equipment',
    cost: 1,
    attack: 2,
    durability: 2,
  });
  const second = new Card({
    id: 'equipment-test-second',
    name: 'Test Shield',
    type: 'equipment',
    cost: 1,
    durability: 1,
  });

  game.player.hand.add(first);
  game.player.hand.add(second);

  await game.playFromHand(game.player, first.id);
  expect(game.player.hero.equipment).toHaveLength(1);
  expect(game.player.hero.equipment[0]?.id).toBe(first.id);

  await game.playFromHand(game.player, second.id);
  expect(game.player.hero.equipment).toHaveLength(1);
  expect(game.player.hero.equipment[0]?.id).toBe(second.id);

  const equipmentOnBoard = game.player.battlefield.cards
    .filter((card) => card.type === 'equipment')
    .map((card) => card.id);
  expect(equipmentOnBoard).toEqual([second.id]);

  const graveyardIds = game.player.graveyard.cards.map((card) => card.id);
  expect(graveyardIds).toContain(first.id);

  expect(game.player.log.some((entry) => entry.includes('Test Blade was destroyed when Test Shield was equipped.')))
    .toBe(true);
});
