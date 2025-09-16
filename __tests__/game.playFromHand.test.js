import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('playing an ally moves it from hand to battlefield', async () => {
  const g = new Game();
  const ally = new Card({ type: 'ally', name: 'Footman', cost: 0 });
  g.player.hand.add(ally);
  const result = await g.playFromHand(g.player, ally.id);
  expect(result).toBe(true);
  expect(g.player.battlefield.cards).toContain(ally);
  expect(g.player.hand.cards).not.toContain(ally);
});

test('counter secret writes combat log entries when triggered', async () => {
  const g = new Game();
  const counterShot = new Card({
    type: 'spell',
    name: 'Counter Shot',
    cost: 0,
    effects: [{ type: 'counterShot' }],
  });

  await g.effects.execute(counterShot.effects, { game: g, player: g.opponent, card: counterShot });

  g.resources._pool.set(g.player, 10);
  g.resources._pool.set(g.opponent, 10);

  const spell = new Card({ type: 'spell', name: 'Arcane Blast', cost: 1 });
  g.player.hand.add(spell);

  const played = await g.playFromHand(g.player, spell.id);

  expect(played).toBe(true);
  expect(g.opponent.log).toContain('Secret triggered: Counter Shot');
  expect(g.player.log).toContain('Enemy secret triggered: Counter Shot');
});
