import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('AI heals its own hero with Healing Potion', async () => {
  const g = new Game();
  await g.setupMatch();

  // clear zones
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];

  // ensure opponent hero is damaged and has resources
  g.resources._pool.set(g.opponent, 10);
  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 20;
  const initialPlayerHealth = g.player.hero.data.health;

  // add Healing Potion to opponent hand
  const potionData = g.allCards.find(c => c.id === 'consumable-healing-potion');
  const potion = new Card(potionData);
  g.opponent.hand.add(potion);

  // it's the AI's turn
  g.turns.setActivePlayer(g.opponent);
  // force RNG to pick the player's hero if promptTarget were used
  g.rng.pick = (arr) => arr[1];

  await g.playFromHand(g.opponent, potion.id);

  expect(g.opponent.hero.data.health).toBe(25);
  expect(g.player.hero.data.health).toBe(initialPlayerHealth);
});
