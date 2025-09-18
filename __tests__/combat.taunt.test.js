import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

function setupGameWithTauntDefender() {
  const game = new Game(null, { aiPlayers: [] });
  const { player, opponent } = game;

  player.hero = new Hero({ id: 'player-hero', name: 'Garrosh', data: { attack: 0, health: 30 } });
  opponent.hero = new Hero({ id: 'ai-hero', name: 'Illidan', data: { attack: 0, health: 30 } });
  player.hero.owner = player;
  opponent.hero.owner = opponent;

  const grunt = new Card({
    id: 'grunt',
    name: 'Orgrimmar Grunt',
    type: 'ally',
    keywords: ['Taunt'],
    data: { attack: 2, health: 2 },
  });
  grunt.owner = player;
  player.battlefield.add(grunt);

  const attacker = new Card({
    id: 'footman',
    name: 'Stormwind Footman',
    type: 'ally',
    data: { attack: 1, health: 2, attacked: false, summoningSick: false, attacksUsed: 0 },
  });
  attacker.owner = opponent;
  opponent.battlefield.add(attacker);

  return { game, player, opponent, grunt, attacker };
}

describe('combat taunt enforcement', () => {
  test('attacks targeting the hero are redirected to an available taunt defender', async () => {
    const { game, player, opponent, grunt, attacker } = setupGameWithTauntDefender();

    const result = await game.attack(opponent, attacker.id, player.hero.id);

    expect(result).toBe(true);
    expect(player.hero.data.health).toBe(30);
    expect(grunt.data.health).toBe(1);
  });

  test('attacks succeed when the taunt defender is targeted', async () => {
    const { game, player, opponent, grunt, attacker } = setupGameWithTauntDefender();

    const result = await game.attack(opponent, attacker.id, grunt.id);

    expect(result).toBe(true);
    expect(player.hero.data.health).toBe(30);
    expect(grunt.data.health).toBe(1);
  });
});

