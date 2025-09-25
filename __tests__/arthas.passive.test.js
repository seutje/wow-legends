import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));

const arthasData = heroCards.find((c) => c.id === 'hero-arthas-menethil-deathlord');
const fallbackHero = heroCards.find((c) => c.id !== 'hero-arthas-menethil-deathlord');

function setupGameWithArthas() {
  const game = new Game();
  game.player.hero = new Hero(arthasData);
  game.player.hero.owner = game.player;
  if (fallbackHero) {
    game.opponent.hero = new Hero(fallbackHero);
    game.opponent.hero.owner = game.opponent;
  }
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

test('Arthas gains 1 Armor at the end of each of your turns', async () => {
  expect(arthasData).toBeDefined();

  const game = setupGameWithArthas();
  await activatePassive(game);

  const { hero } = game.player;
  expect(hero.data.armor).toBe(0);

  game.turns.bus.emit('turn:start', { player: game.player });
  expect(hero.data.armor).toBe(0);

  game.turns.bus.emit('turn:start', { player: game.opponent });
  expect(hero.data.armor).toBe(1);

  game.turns.bus.emit('turn:start', { player: game.player });
  expect(hero.data.armor).toBe(1);

  game.turns.bus.emit('turn:start', { player: game.opponent });
  expect(hero.data.armor).toBe(2);
});
