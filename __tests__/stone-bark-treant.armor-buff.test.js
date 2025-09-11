import Game from '../src/js/game.js';
import { enforceTaunt } from '../src/js/systems/keywords.js';

describe('Stone Bark Treant', () => {
  test('gains health when hero gains armor and has taunt', async () => {
    const g = new Game();
    await g.setupMatch();
    g.resources._pool.set(g.player, 10);

    // Hero gains armor before Treant is played
    await g.effects.applyBuff({ target: 'hero', property: 'armor', amount: 2 }, { game: g, player: g.player, card: null });

    g.addCardToHand('ally-stone-bark-treant');
    await g.playFromHand(g.player, 'ally-stone-bark-treant');
    const treant = g.player.battlefield.cards.find(c => c.name === 'Stone Bark Treant');

    // Should have received +0/+2 from earlier armor gain
    expect(treant.data.health).toBe(8);

    // Taunt enforcement
    const targets = enforceTaunt([g.player.hero, treant]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe(treant);

    // Gaining armor again buffs Treant further
    await g.effects.applyBuff({ target: 'hero', property: 'armor', amount: 1 }, { game: g, player: g.player, card: null });
    expect(treant.data.health).toBe(10);
  });
});
