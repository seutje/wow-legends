import fs from 'fs';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

const cards = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url)));
const savory = cards.find(c => c.id === 'consumable-savory-deviate-delight');

test('Savory Deviate Delight only transforms allies', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const ally = new Card({ name: 'Ally', type: 'ally', data: { attack: 1, health: 1 }, keywords: [] });
  const equipment = new Card({ name: 'Sword', type: 'equipment', data: {}, keywords: [] });
  const quest = new Card({ name: 'Quest', type: 'quest', data: {}, keywords: [] });
  g.player.battlefield.add(ally);
  g.player.battlefield.add(equipment);
  g.player.battlefield.add(quest);

  const card = new Card(savory);
  g.player.hand.add(card);

  await g.playFromHand(g.player, card.id);

  const transformed = g.player.battlefield.cards.find(c => c.id === ally.id);
  expect(transformed.name).toBe('Pirate');
  expect(g.player.battlefield.cards.find(c => c.id === equipment.id).name).toBe('Sword');
  expect(g.player.battlefield.cards.find(c => c.id === quest.id).name).toBe('Quest');
  expect(g.player.hero.name).not.toBe('Pirate');
});

test('Savory Deviate Delight transforms summoned allies', async () => {
  const g = new Game();
  await g.setupMatch();

  g.player.hand.cards = [];
  g.player.battlefield.cards = [];
  g.resources._pool.set(g.player, 10);

  const summoner = new Card({ name: 'Summoner', type: 'spell', data: {}, keywords: [] });
  const token = { id: 'token', name: 'Token', data: { attack: 1, health: 1 }, keywords: [], summonedBy: summoner };
  const quest = new Card({ name: 'Quest', type: 'quest', data: {}, keywords: [] });
  g.player.battlefield.add(token);
  g.player.battlefield.add(quest);

  const card = new Card(savory);
  g.player.hand.add(card);

  await g.playFromHand(g.player, card.id);

  const transformed = g.player.battlefield.cards.find(c => c.id === token.id);
  expect(transformed.name).toBe('Pirate');
  expect(g.player.battlefield.cards.find(c => c.id === quest.id).name).toBe('Quest');
});
