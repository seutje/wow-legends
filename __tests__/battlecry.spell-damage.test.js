import fs from 'fs';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));

const sunreaverBowman = allyCards.find(c => c.id === 'ally-sunreaver-bowman');

function setupPlayerForBattlecryTest(game) {
  game.turns.turn = Math.max(2, game.turns.turn);
  game.resources.startTurn(game.player);
  game.turns.setActivePlayer(game.player);
}

test('Battlecry damage scales with Spell Damage bonuses', async () => {
  expect(sunreaverBowman).toBeDefined();
  const g = new Game();
  setupPlayerForBattlecryTest(g);

  const target = new Card({ name: 'Target Dummy', type: 'ally', data: { attack: 0, health: 4 } });
  g.opponent.battlefield.add(target);

  const spellBoost = new Card({ name: 'Spell Booster', type: 'ally', data: { attack: 0, health: 1, spellDamage: 1 } });
  g.player.battlefield.add(spellBoost);

  g.promptTarget = async () => target;

  const battlecry = new Card(sunreaverBowman);
  g.player.hand.add(battlecry);

  const before = target.data.health;
  await g.playFromHand(g.player, battlecry.id);

  expect(target.data.health).toBe(before - 2);
});

test('Battlecry damage deals its base amount without Spell Damage', async () => {
  expect(sunreaverBowman).toBeDefined();
  const g = new Game();
  setupPlayerForBattlecryTest(g);

  const target = new Card({ name: 'Target Dummy', type: 'ally', data: { attack: 0, health: 4 } });
  g.opponent.battlefield.add(target);

  g.promptTarget = async () => target;

  const battlecry = new Card(sunreaverBowman);
  g.player.hand.add(battlecry);

  const before = target.data.health;
  await g.playFromHand(g.player, battlecry.id);

  expect(target.data.health).toBe(before - 1);
});
