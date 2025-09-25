import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const jainaData = heroCards.find((c) => c.id === 'hero-jaina-proudmoore-archmage');
const fallbackHero = heroCards.find((c) => c.id !== 'hero-jaina-proudmoore-archmage');

function setupGameWithJaina() {
  const game = new Game();
  game.player.hero = new Hero(jainaData);
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

function createWaterElemental() {
  return new Card({
    id: 'token-water-elemental',
    name: 'Water Elemental',
    type: 'ally',
    data: { attack: 3, health: 6 },
    keywords: ['Freeze'],
  });
}

function createWaterElementalGuardian() {
  return new Card({
    id: 'ally-water-elemental-guardian',
    name: 'Water Elemental Guardian',
    type: 'ally',
    data: { attack: 3, health: 6 },
    keywords: ['Freeze'],
  });
}

test("Jaina gains Spell Damage while controlling a Water Elemental", async () => {
  expect(jainaData).toBeDefined();
  const game = setupGameWithJaina();
  await activatePassive(game);

  expect(game.player.hero.data.spellDamage ?? 0).toBe(0);

  const elemental = createWaterElemental();
  game.player.battlefield.add(elemental);
  game.bus.emit('unitSummoned', { player: game.player, card: elemental });

  expect(game.player.hero.data.spellDamage).toBe(1);

  game.player.battlefield.remove(elemental);
  game.bus.emit('allyDefeated', { player: game.opponent, card: elemental });

  expect(game.player.hero.data.spellDamage ?? 0).toBe(0);
});

test('Water Elemental Guardian counts for Jaina passive but does not stack', async () => {
  expect(jainaData).toBeDefined();
  const game = setupGameWithJaina();
  await activatePassive(game);

  const guardian = createWaterElementalGuardian();
  game.player.battlefield.add(guardian);
  game.bus.emit('cardPlayed', { player: game.player, card: guardian });

  expect(game.player.hero.data.spellDamage).toBe(1);

  const elemental = createWaterElemental();
  game.player.battlefield.add(elemental);
  game.bus.emit('unitSummoned', { player: game.player, card: elemental });

  expect(game.player.hero.data.spellDamage).toBe(1);
});

