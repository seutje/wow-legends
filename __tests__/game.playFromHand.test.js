/** @jest-environment jsdom */

import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import { renderPlay } from '../src/js/ui/play.js';

test('playing an ally moves it from hand to battlefield', async () => {
  const g = new Game();
  const ally = new Card({ type: 'ally', name: 'Footman', cost: 0 });
  g.player.hand.add(ally);
  const result = await g.playFromHand(g.player, ally.id);
  expect(result).toBe(true);
  expect(g.player.battlefield.cards).toContain(ally);
  expect(g.player.hand.cards).not.toContain(ally);
});

test('counter secret writes combat log entries when triggered', async () => {
  const g = new Game();
  const counterShot = new Card({
    type: 'spell',
    name: 'Counter Shot',
    cost: 0,
    effects: [{ type: 'counterShot' }],
  });

  await g.effects.execute(counterShot.effects, { game: g, player: g.opponent, card: counterShot });

  g.resources._pool.set(g.player, 10);
  g.resources._pool.set(g.opponent, 10);

  const spell = new Card({ type: 'spell', name: 'Arcane Blast', cost: 1 });
  g.player.hand.add(spell);

  const played = await g.playFromHand(g.player, spell.id);

  expect(played).toBe(true);
  expect(g.opponent.log).toContain('Secret triggered: Counter Shot');
  expect(g.player.log).toContain('Enemy secret triggered: Counter Shot');
});

test('countering a secret removes secret badges from both heroes', async () => {
  const g = new Game();

  const container = document.createElement('div');
  const rerender = () => { renderPlay(container, g, { onUpdate: rerender }); };
  g.setUIRerender(rerender);
  rerender();

  const counterShot = new Card({
    type: 'spell',
    name: 'Counter Shot',
    cost: 0,
    keywords: ['Secret'],
    effects: [{ type: 'counterShot' }],
  });
  await g.effects.execute(counterShot.effects, { game: g, player: g.opponent, card: counterShot });

  const secret = new Card({
    type: 'spell',
    name: 'Snake Trap',
    cost: 0,
    keywords: ['Secret'],
    effects: [{ type: 'snakeTrap' }],
  });

  g.player.hand.add(secret);
  g.resources._pool.set(g.player, 10);
  g.resources._pool.set(g.opponent, 10);

  await g.playFromHand(g.player, secret.id);

  const opponentSecrets = Array.isArray(g.opponent.hero.data.secrets)
    ? g.opponent.hero.data.secrets.length
    : 0;
  const playerSecrets = Array.isArray(g.player.hero.data.secrets)
    ? g.player.hero.data.secrets.length
    : 0;

  expect(opponentSecrets).toBe(0);
  expect(playerSecrets).toBe(0);
  expect(container.querySelectorAll('.ai-hero .stat.secret')).toHaveLength(0);
  expect(container.querySelectorAll('.p-hero .stat.secret')).toHaveLength(0);
});

test('canceling targeted ally keeps its original hand position', async () => {
  const g = new Game();
  const first = new Card({ type: 'ally', name: 'Frontliner', cost: 0 });
  const targetAlly = new Card({
    type: 'ally',
    name: 'Battlecry Slinger',
    cost: 0,
    effects: [{ type: 'dealDamage', amount: 1 }],
  });
  const third = new Card({ type: 'ally', name: 'Backliner', cost: 0 });
  g.player.hand.add(first);
  g.player.hand.add(targetAlly);
  g.player.hand.add(third);

  const initialOrder = g.player.hand.cards.map(c => c.id);
  const originalIndex = g.player.hand.cards.indexOf(targetAlly);

  const spy = jest.spyOn(g.effects, 'execute').mockImplementation(async () => {
    throw g.CANCEL;
  });

  let played;
  try {
    played = await g.playFromHand(g.player, targetAlly.id);
  } finally {
    spy.mockRestore();
  }

  expect(played).toBe(false);
  expect(g.player.hand.cards.indexOf(targetAlly)).toBe(originalIndex);
  expect(g.player.hand.cards.map(c => c.id)).toEqual(initialOrder);
});
