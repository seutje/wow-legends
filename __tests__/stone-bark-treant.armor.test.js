import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

const getTreant = (g) => new Card(g.allCards.find(c => c.id === 'ally-stone-bark-treant'));

test('Stone Bark Treant does not gain +0/+2 from armor gained before it entered play', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  await g.effects.execute(
    [{ type: 'buff', target: 'hero', property: 'armor', amount: 2 }],
    { game: g, player: g.player, card: g.player.hero }
  );

  const treant = getTreant(g);
  g.player.hand.add(treant);
  await g.playFromHand(g.player, treant.id);

  expect(treant.data.health).toBe(6);
});

test('Stone Bark Treant gains +0/+2 whenever its hero gains armor', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const treant = getTreant(g);
  g.player.hand.add(treant);
  await g.playFromHand(g.player, treant.id);

  expect(treant.data.health).toBe(6);

  await g.effects.execute(
    [{ type: 'buff', target: 'hero', property: 'armor', amount: 2 }],
    { game: g, player: g.player, card: g.player.hero }
  );

  expect(treant.data.health).toBe(8);
});

