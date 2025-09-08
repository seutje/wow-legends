import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

describe('EffectSystem', () => {
  test('dead allies move from battlefield to graveyard', () => {
    const game = new Game();
    const player = game.player;
    const ally = new Card({ type: 'ally', name: 'A', data: { attack: 0, health: 1 } });
    player.battlefield.add(ally);

    game.effects.dealDamage(
      { target: 'allCharacters', amount: 1 },
      { game, player, card: null }
    );

    expect(player.battlefield.cards.length).toBe(0);
    expect(player.graveyard.cards).toContain(ally);
  });
});

