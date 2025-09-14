import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

test('Windfury allies can attack twice in a turn', async () => {
  const g = new Game();
  // Set up simple heroes
  g.player.hero = new Hero({ name: 'You', data: { health: 30 } });
  g.opponent.hero = new Hero({ name: 'AI', data: { health: 10 } });

  // Add a Windfury ally to player's battlefield
  const wf = new Card({ type: 'ally', name: 'Windfury Test', data: { attack: 3, health: 3 }, keywords: ['Windfury'] });
  g.player.battlefield.add(wf);

  // Start player's turn to ensure attack flags reset
  g.turns.setActivePlayer(g.player);
  g.turns.startTurn();

  // First attack
  let ok = await g.attack(g.player, wf.id);
  expect(ok).toBe(true);
  expect(g.opponent.hero.data.health).toBe(7); // 10 - 3

  // Second attack (Windfury)
  ok = await g.attack(g.player, wf.id);
  expect(ok).toBe(true);
  expect(g.opponent.hero.data.health).toBe(4); // 7 - 3

  // Third attack should fail
  ok = await g.attack(g.player, wf.id);
  expect(ok).toBe(false);
  expect(g.opponent.hero.data.health).toBe(4);
});

