import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

test('MCTS prefers lethal damage over healing', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 200, rolloutDepth: 3 });
  g.turns.turn = 5;

  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 20;
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 2;

  const dmg = new Card({ type: 'spell', name: 'Zap', cost: 1, effects: [{ type: 'damage', target: 'any', amount: 2 }] });
  const heal = new Card({ type: 'consumable', name: 'Bandage', cost: 1, effects: [{ type: 'heal', target: 'character', amount: 5 }] });
  g.opponent.hand.add(dmg);
  g.opponent.hand.add(heal);

  g.turns.setActivePlayer(g.opponent);
  // ensure enough resources
  g.resources._pool.set(g.opponent, 5);

  return ai.takeTurn(g.opponent, g.player).then(() => {
    // Player (enemy) should be at 0 (lethal from Zap)
    expect(g.player.hero.data.health).toBe(0);
    // Zap should be in graveyard; heal likely remains in hand (not required)
    expect(g.opponent.graveyard.cards.find(c => c.name === 'Zap')).toBeTruthy();
  });
});

test('MCTS can chain multiple plays in a turn', () => {
  const g = new Game();
  const ai = new MCTS_AI({ resourceSystem: g.resources, combatSystem: g.combat, game: g, iterations: 250, rolloutDepth: 4 });
  g.turns.turn = 4;
  g.opponent.hero.data.maxHealth = 30;
  g.opponent.hero.data.health = 30;
  g.player.hero.data.maxHealth = 30;
  g.player.hero.data.health = 10;

  const zap1 = new Card({ type: 'spell', name: 'Zap A', cost: 1, effects: [{ type: 'damage', target: 'any', amount: 2 }] });
  const zap2 = new Card({ type: 'spell', name: 'Zap B', cost: 1, effects: [{ type: 'damage', target: 'any', amount: 2 }] });
  g.opponent.hand.add(zap1);
  g.opponent.hand.add(zap2);
  g.resources._pool.set(g.opponent, 2);
  g.turns.setActivePlayer(g.opponent);

  return ai.takeTurn(g.opponent, g.player).then(() => {
    // Expect both spells cast and 4 damage dealt in total (attacks may add more but at least 4)
    expect(g.opponent.graveyard.cards.find(c => c.name === 'Zap A')).toBeTruthy();
    expect(g.opponent.graveyard.cards.find(c => c.name === 'Zap B')).toBeTruthy();
    expect(g.player.hero.data.health).toBeLessThanOrEqual(6);
  });
});
