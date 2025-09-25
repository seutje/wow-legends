import fs from 'fs';
import Game from '../src/js/game.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';

const heroCards = JSON.parse(fs.readFileSync(new URL('../data/cards/hero.json', import.meta.url)));
const tyrandeData = heroCards.find((c) => c.id === 'hero-tyrande-whisperwind-high-priestess');
const fallbackHero = heroCards.find((c) => c.id !== 'hero-tyrande-whisperwind-high-priestess');

function setupGameWithTyrande() {
  const game = new Game();
  if (tyrandeData) {
    game.player.hero = new Hero(tyrandeData);
    game.player.hero.owner = game.player;
  }
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

function createLibraryCard(id) {
  return new Card({ id, name: id, type: 'spell', cost: 1 });
}

test("Restoring Tyrande to full health draws only once per turn", async () => {
  expect(tyrandeData).toBeDefined();
  const game = setupGameWithTyrande();
  await activatePassive(game);

  game.player.library.cards.push(createLibraryCard('spell-dummy-1'));
  game.player.library.cards.push(createLibraryCard('spell-dummy-2'));

  game.player.hero.data.health = 24;
  game.player.hero.data.maxHealth = 30;

  expect(game.player.hand.cards).toHaveLength(0);

  await game.effects.healCharacter(
    { target: 'selfHero', amount: 6 },
    { game, player: game.player, card: game.player.hero }
  );

  expect(game.player.hero.data.health).toBe(30);
  expect(game.player.hand.cards).toHaveLength(1);

  game.player.hero.data.health = 25;

  await game.effects.healCharacter(
    { target: 'selfHero', amount: 10 },
    { game, player: game.player, card: game.player.hero }
  );

  expect(game.player.hand.cards).toHaveLength(1);

  game.turns.bus.emit('turn:start', { player: game.player });

  game.player.hero.data.health = 28;

  await game.effects.healCharacter(
    { target: 'selfHero', amount: 5 },
    { game, player: game.player, card: game.player.hero }
  );

  expect(game.player.hand.cards).toHaveLength(2);
});

test('Restoring a friendly ally to full health triggers Tyrande passive', async () => {
  expect(tyrandeData).toBeDefined();
  const game = setupGameWithTyrande();
  await activatePassive(game);

  game.player.library.cards.push(createLibraryCard('spell-dummy-3'));
  game.player.library.cards.push(createLibraryCard('spell-dummy-4'));

  const ally = new Card({
    id: 'tyrande-passive-ally',
    name: 'Tyrande Test Ally',
    type: 'ally',
    data: { attack: 3, health: 4 },
  });
  ally.owner = game.player;
  game.player.battlefield.add(ally);

  const initialHandSize = game.player.hand.cards.length;

  const originalPrompt = game.promptTarget;
  try {
    ally.data.health = 1;
    game.promptTarget = async () => ally;
    await game.effects.healCharacter(
      { target: 'character', amount: 2 },
      { game, player: game.player, card: game.player.hero }
    );

    expect(game.player.hand.cards).toHaveLength(initialHandSize);

    ally.data.health = 2;
    game.promptTarget = async () => ally;
    await game.effects.healCharacter(
      { target: 'character', amount: 5 },
      { game, player: game.player, card: game.player.hero }
    );
  } finally {
    game.promptTarget = originalPrompt;
  }

  expect(ally.data.health).toBe(4);
  expect(game.player.hand.cards).toHaveLength(initialHandSize + 1);
});
