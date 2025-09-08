import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test("Arcanist's Signet grants +1 Spell Damage to the first spell each turn", async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.opponent.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);
  const signet = new Card({
    id: 'equipment-arcanist-s-signet',
    name: "Arcanist's Signet",
    type: 'equipment',
    cost: 0,
    effects: [{ type: 'spellDamageNextSpell', amount: 1, eachTurn: true }],
  });
  g.player.hand.add(signet);
  await g.playFromHand(g.player, signet.id);

  const makeSpell = () => new Card({
    id: 'spell-test-' + Math.random(),
    name: 'Test Spell',
    type: 'spell',
    cost: 0,
    effects: [{ type: 'damage', target: 'allEnemies', amount: 1 }],
  });

  const spell1 = makeSpell();
  g.player.hand.add(spell1);
  await g.playFromHand(g.player, spell1.id);
  expect(g.opponent.hero.data.health).toBe(28);

  const spell2 = makeSpell();
  g.player.hand.add(spell2);
  await g.playFromHand(g.player, spell2.id);
  expect(g.opponent.hero.data.health).toBe(27);

  g.turns.setActivePlayer(g.opponent);
  g.turns.startTurn();
  g.turns.setActivePlayer(g.player);
  g.turns.startTurn();

  const spell3 = makeSpell();
  g.player.hand.add(spell3);
  await g.playFromHand(g.player, spell3.id);
  expect(g.opponent.hero.data.health).toBe(25);
});
