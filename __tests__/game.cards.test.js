import Game from '../src/js/game.js';

test('setupMatch creates a 60 card library', async () => {
  const g = new Game();
  await g.setupMatch();
  expect(g.player.library.cards.length + g.player.hand.cards.length).toBe(60);
  expect(g.opponent.library.cards.length + g.opponent.hand.cards.length).toBe(60);
});

test('setupMatch assigns different heroes to players', async () => {
  const g = new Game();
  await g.setupMatch();
  expect(g.player.hero).toBeDefined();
  expect(g.opponent.hero).toBeDefined();
  expect(g.player.hero.id).not.toBe(g.opponent.hero.id);
});

test('cards loaded with text for tooltips', async () => {
  const g = new Game();
  await g.setupMatch();
  const hasText = g.allCards.every(c => typeof c.text === 'string');
  expect(hasText).toBe(true);
});

test('players draw a card at the start of their turn', async () => {
  const g = new Game();
  await g.setupMatch();
  const before = g.player.hand.size();
  if (g.turns.activePlayer !== g.player) {
    g.turns.setActivePlayer(g.player);
  }
  g.turns.startTurn();
  expect(g.player.hand.size()).toBe(before + 1);
});

test('AI decks exclude quest cards by default', async () => {
  const g = new Game();
  await g.setupMatch();
  expect(g.allCards.some(c => c.type === 'quest')).toBe(true);
  const playerZones = [...g.player.library.cards, ...g.player.hand.cards];
  const opponentZones = [...g.opponent.library.cards, ...g.opponent.hand.cards];
  expect(playerZones.every(c => c.type !== 'quest')).toBe(true);
  expect(opponentZones.every(c => c.type !== 'quest')).toBe(true);
});

test('human decks retain quests when player is not AI', async () => {
  const g = new Game(null, { aiPlayers: ['opponent'] });
  await g.setupMatch();
  const hero = g.allCards.find(c => c.type === 'hero');
  const quest = g.allCards.find(c => c.type === 'quest');
  const filler = g.allCards.find(c => c.type !== 'hero' && c.type !== 'quest');
  expect(hero).toBeTruthy();
  expect(quest).toBeTruthy();
  expect(filler).toBeTruthy();
  const cards = [quest, ...Array(59).fill(filler)];
  await g.setupMatch({ hero, cards });
  const playerZones = [...g.player.library.cards, ...g.player.hand.cards];
  expect(playerZones.filter(c => c.type === 'quest')).toHaveLength(1);
});

test('AI provided decks strip quests for the player', async () => {
  const g = new Game(null, { aiPlayers: ['player', 'opponent'] });
  await g.setupMatch();
  const hero = g.allCards.find(c => c.type === 'hero');
  const quest = g.allCards.find(c => c.type === 'quest');
  const filler = g.allCards.find(c => c.type !== 'hero' && c.type !== 'quest');
  expect(hero).toBeTruthy();
  expect(quest).toBeTruthy();
  expect(filler).toBeTruthy();
  const cards = [quest, ...Array(59).fill(filler)];
  await g.setupMatch({ hero, cards });
  const playerZones = [...g.player.library.cards, ...g.player.hand.cards];
  expect(playerZones.every(c => c.type !== 'quest')).toBe(true);
  expect(playerZones.length).toBe(60);
});
