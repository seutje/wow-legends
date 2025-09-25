import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const allyCards = JSON.parse(fs.readFileSync(new URL('../data/cards/ally.json', import.meta.url)));

const utherData = heroCards.find((c) => c.id === 'hero-uther-the-lightbringer');
const fallbackHero = heroCards.find((c) => c.id !== 'hero-uther-the-lightbringer');

function setupGameWithUther() {
  const game = new Game();
  game.player.hero = new Hero(utherData);
  game.player.hero.owner = game.player;
  if (fallbackHero) {
    game.opponent.hero = new Hero(fallbackHero);
    game.opponent.hero.owner = game.opponent;
  }
  game.allCards = [utherData, ...allyCards];
  game._cardIndex = new Map(game.allCards.map((card) => [card.id, card]));
  return game;
}

async function activatePassive(game) {
  if (!game.player?.hero?.passive?.length) return;
  await game.effects.execute(game.player.hero.passive, {
    game,
    player: game.player,
    card: game.player.hero,
  });
}

const countRecruits = (game) =>
  game.player.battlefield.cards.filter((c) => c.id === 'ally-silver-hand-recruit').length;

test('Uther summons a Silver Hand Recruit every 5 mana spent', async () => {
  expect(utherData).toBeDefined();
  const game = setupGameWithUther();
  await activatePassive(game);

  expect(countRecruits(game)).toBe(0);

  game.bus.emit('resources:spent', { player: game.player, amount: 3 });
  game.bus.emit('cardPlayed', { player: game.player, card: { id: 'test-spell', type: 'spell' } });
  expect(countRecruits(game)).toBe(0);

  game.bus.emit('resources:spent', { player: game.player, amount: 2 });
  game.bus.emit('heroPowerUsed', { player: game.player, hero: game.player.hero, cost: 2 });
  let recruits = game.player.battlefield.cards.filter((c) => c.id === 'ally-silver-hand-recruit');
  expect(recruits).toHaveLength(1);
  expect(recruits[0]?.data?.attack ?? recruits[0]?.attack).toBe(1);
  expect(recruits[0]?.data?.health ?? recruits[0]?.health).toBe(1);

  game.bus.emit('resources:spent', { player: game.player, amount: 4 });
  game.bus.emit('resources:refunded', { player: game.player, amount: 4 });
  game.bus.emit('cardPlayed', { player: game.player, card: { id: 'cancelled', type: 'spell' } });
  expect(countRecruits(game)).toBe(1);

  game.bus.emit('resources:spent', { player: game.player, amount: 5 });
  game.bus.emit('cardPlayed', { player: game.player, card: { id: 'big-spell', type: 'spell' } });
  expect(countRecruits(game)).toBe(2);
});
