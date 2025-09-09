import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Whirlwind damages both sides when cast by opponent', async () => {
  const g = new Game();
  await g.setupMatch();

  // clear zones for controlled scenario
  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.hand.cards = [];
  g.opponent.battlefield.cards = [];
  g.player.hero.data.armor = 0;
  g.opponent.hero.data.armor = 0;
  g.resources._pool.set(g.opponent, 10);

  // friendly minion
  const friendly = new Card({ name: 'Friendly', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  g.player.battlefield.add(friendly);
  // enemy minion
  const enemy = new Card({ name: 'Enemy', type: 'ally', data: { attack: 0, health: 3 }, keywords: [] });
  g.opponent.battlefield.add(enemy);

  // add Whirlwind to opponent hand
  const whirlwindData = g.allCards.find(c => c.id === 'spell-whirlwind');
  const whirlwind = new Card(whirlwindData);
  g.opponent.hand.add(whirlwind);

  const initialPlayerHero = g.player.hero.data.health;
  const initialOpponentHero = g.opponent.hero.data.health;

  await g.playFromHand(g.opponent, whirlwind.id);

  expect(friendly.data.health).toBe(2);
  expect(enemy.data.health).toBe(2);
  expect(g.player.hero.data.health).toBe(initialPlayerHero - 1);
  expect(g.opponent.hero.data.health).toBe(initialOpponentHero - 1);
});
