import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const effectCards = cards.filter(c => c.effects && c.effects[0] && c.effects[0].type !== 'rawText');

describe.each(effectCards)('$id executes its effect', (card) => {
  test('effect works as defined', async () => {
    const g = new Game();
    await g.setupMatch();

    // clean zones for deterministic counts
    g.player.hand.cards = [];
    g.opponent.hand.cards = [];
    g.player.battlefield.cards = [];
    g.opponent.battlefield.cards = [];

    // plenty of resources
    g.resources._pool.set(g.player, 10);
    g.resources._pool.set(g.opponent, 10);

    const effect = card.effects[0];

    if (card.type === 'hero') {
      g.player.hero = new Hero(card);
      if (effect.type === 'heal') {
        g.player.hero.data.maxHealth = 30;
        g.player.hero.data.health = 20;
        await g.effects.execute(card.effects, { game: g, player: g.player, card: g.player.hero });
        expect(g.player.hero.data.health).toBe(20 + effect.amount);
      } else if (effect.type === 'damage') {
        const before = g.opponent.hero.data.health;
        await g.effects.execute(card.effects, { game: g, player: g.player, card: g.player.hero });
        expect(g.opponent.hero.data.health).toBe(before - effect.amount);
      } else if (effect.type === 'draw') {
        const handBefore = g.player.hand.cards.length;
        await g.effects.execute(card.effects, { game: g, player: g.player, card: g.player.hero });
        expect(g.player.hand.cards.length).toBe(handBefore + effect.count);
      }
      return;
    }

    g.addCardToHand(card.id);
    const handStart = g.player.hand.cards.length;

    switch (effect.type) {
      case 'damage': {
        if (effect.target === 'allCharacters') {
          g.player.battlefield.add(new Card({ name: 'Ally', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] }));
          g.opponent.battlefield.add(new Card({ name: 'Enemy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] }));
        }
        if (effect.target === 'allEnemies') {
          g.opponent.battlefield.add(new Card({ name: 'Enemy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] }));
        }
        if (['any', 'minion', 'enemyHeroOrMinionWithoutTaunt', 'character'].includes(effect.target)) {
          const enemy = new Card({ name: 'Enemy', type: 'ally', data: { attack: 0, health: 5 }, keywords: [] });
          g.opponent.battlefield.add(enemy);
          g.promptTarget = async () => enemy;
          const before = enemy.data.health;
          await g.playFromHand(g.player, card.id);
          expect(enemy.data.health).toBe(before - effect.amount);
        } else {
          const oppBefore = g.opponent.hero.data.health;
          const playerBefore = g.player.hero.data.health;
          await g.playFromHand(g.player, card.id);
          expect(g.opponent.hero.data.health).toBe(oppBefore - effect.amount);
          if (effect.target === 'allCharacters') {
            expect(g.player.hero.data.health).toBe(playerBefore - effect.amount);
          }
        }
        break;
      }
      case 'summon': {
        const bfBefore = g.player.battlefield.cards.length;
        await g.playFromHand(g.player, card.id);
        const expected = bfBefore + effect.count + (card.type === 'ally' ? 1 : 0);
        expect(g.player.battlefield.cards.length).toBe(expected);
        const summoned = g.player.battlefield.cards.filter(c => c.name === effect.unit.name);
        expect(summoned.length).toBe(effect.count);
        expect(summoned[0].data.attack).toBe(effect.unit.attack);
        expect(summoned[0].data.health).toBe(effect.unit.health);
        break;
      }
      case 'buff': {
        g.player.battlefield.add(new Card({ name: 'Ally', type: 'ally', data: { attack: 1, health: 1 }, keywords: [] }));
        const heroAttack = g.player.hero.data.attack || 0;
        await g.playFromHand(g.player, card.id);
        expect(g.player.hero.data.attack).toBe(heroAttack + effect.amount);
        break;
      }
      case 'overload': {
        const overloadBefore = g.resources._overloadNext.get(g.player) || 0;
        await g.playFromHand(g.player, card.id);
        expect(g.resources._overloadNext.get(g.player)).toBe(overloadBefore + effect.amount);
        break;
      }
      case 'heal': {
        g.player.hero.data.maxHealth = 30;
        g.player.hero.data.health = 20;
        await g.playFromHand(g.player, card.id);
        expect(g.player.hero.data.health).toBe(20 + effect.amount);
        break;
      }
      case 'draw': {
        await g.playFromHand(g.player, card.id);
        expect(g.player.hand.cards.length).toBe(handStart - 1 + effect.count);
        break;
      }
      case 'destroy': {
        g.opponent.battlefield.add(new Card({ name: 'Enemy', type: 'ally', data: { attack: 2, health: 2 }, keywords: [] }));
        await g.playFromHand(g.player, card.id);
        expect(g.opponent.battlefield.cards.length).toBe(0);
        break;
      }
      case 'returnToHand': {
        const enemy = new Card({ name: 'Enemy', type: 'ally', cost: 2, data: { attack: 2, health: 2 }, keywords: [] });
        g.opponent.battlefield.add(enemy);
        await g.playFromHand(g.player, card.id);
        expect(g.opponent.battlefield.cards.length).toBe(0);
        expect(g.opponent.hand.cards[0].cost).toBe(3);
        break;
      }
      case 'transform': {
        const ally = new Card({ name: 'Ally', type: 'ally', data: { attack: 1, health: 1 }, keywords: [] });
        g.player.battlefield.add(ally);
        await g.playFromHand(g.player, card.id);
        const transformed = g.player.battlefield.cards[0];
        expect(transformed.name).toBe(effect.into.name);
        expect(transformed.data.attack).toBe(effect.into.attack);
        expect(transformed.data.health).toBe(effect.into.health);
        expect(transformed.keywords).toEqual(effect.into.keywords);
        break;
      }
      default:
        throw new Error('Unhandled effect type: ' + effect.type);
    }

    if (card.id === 'spell-feral-spirit') {
      expect(g.resources._overloadNext.get(g.player)).toBe(2);
    }
  });
});
