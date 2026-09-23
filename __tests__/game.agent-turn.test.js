import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import Hero from '../src/js/entities/hero.js';
import { createDecisionState, getLegalActions } from '../src/js/systems/ai-actions.js';

const setup = () => {
  const game = new Game();
  game.turns.turn = 3;
  game.turns.setActivePlayer(game.player);
  game.resources.startTurn(game.player);
  return game;
};
const legal = game => getLegalActions(createDecisionState({
  game, player: game.player, opponent: game.opponent,
  pool: game.resources.pool(game.player), turn: game.turns.turn,
}));

test('applyDecision delegates card, power, and attack to live game methods', async () => {
  const game = setup();
  const card = new Card({ type: 'ally', name: 'Scout', cost: 1, data: { attack: 1, health: 2 } });
  game.player.hand.add(card);
  expect(await game.applyDecision(game.player, game.opponent, legal(game).find(a => a.card === card && !a.usePower))).toBe(true);
  expect(game.player.battlefield.cards).toContain(card);

  game.player.hero = new Hero({ name: 'Caster', data: { health: 30 }, active: [{ type: 'draw', amount: 1 }] });
  const power = legal(game).find(a => a.usePower && !a.card);
  expect(power).toBeDefined();
  expect(await game.applyDecision(game.player, game.opponent, power)).toBe(true);
  expect(game.player.hero.powerUsed).toBe(true);

  game.player.hero = new Hero({ name: 'Fighter', data: { health: 30, attack: 2 } });
  const attack = legal(game).find(a => a.attack?.targetType === 'hero');
  const before = game.opponent.hero.data.health;
  expect(await game.applyDecision(game.player, game.opponent, attack)).toBe(true);
  expect(game.opponent.hero.data.health).toBe(before - 2);
  expect(await game.applyDecision(game.player, game.opponent, {})).toBe(false);
  expect(await game.applyDecision(game.player, game.opponent, null)).toBe(false);
  expect(await game.applyDecision(game.player, game.opponent, { card: { id: 'missing' } })).toBe(false);
});

test('applyDecision preserves compound card and power actions', async () => {
  const game = setup();
  game.player.hero = new Hero({ name: 'Caster', data: { health: 30 }, active: [{ type: 'draw', amount: 1 }] });
  const card = new Card({ type: 'ally', name: 'Scout', cost: 0, data: { attack: 1, health: 1 } });
  game.player.hand.add(card);
  const combined = legal(game).find(a => a.card === card && a.usePower);
  expect(combined).toBeDefined();
  expect(await game.applyDecision(game.player, game.opponent, combined)).toBe(true);
  expect(game.player.battlefield.cards).toContain(card);
  expect(game.player.hero.powerUsed).toBe(true);
});

test('runAgentTurn executes canonical matches and stops at end after multiple decisions', async () => {
  const game = setup();
  const first = new Card({ type: 'ally', name: 'First', cost: 0, data: { attack: 1, health: 1 } });
  const second = new Card({ type: 'ally', name: 'Second', cost: 0, data: { attack: 1, health: 1 } });
  game.player.hand.add(first);
  game.player.hand.add(second);
  const applied = [];
  const original = game.applyDecision.bind(game);
  jest.spyOn(game, 'applyDecision').mockImplementation(async (...args) => {
    applied.push(args[2]);
    return original(...args);
  });
  const agent = { chooseAction: jest.fn(async (_state, actions) => {
    const play = actions.find(a => a.card && !a.usePower);
    if (!play) return actions.find(a => a.end);
    // A matching identifier is accepted, but its untrusted card is never executed.
    return { ...play, card: { ...play.card, effects: [{ type: 'damage', amount: 999 }] } };
  }) };
  expect(await game.runAgentTurn({ agent, player: game.player, opponent: game.opponent, skipStart: true })).toBe(true);
  expect(applied).toHaveLength(2);
  expect(applied[0].card).toBe(first);
  expect(applied[1].card).toBe(second);
  expect(agent.chooseAction).toHaveBeenCalledTimes(2);
});

test('runAgentTurn rejects unknown actions and stops after failure or game over', async () => {
  const game = setup();
  const args = { player: game.player, opponent: game.opponent, skipStart: true };
  const apply = jest.spyOn(game, 'applyDecision');
  game.player.hand.add(new Card({ type: 'ally', name: 'First Scout', cost: 0 }));
  expect(await game.runAgentTurn({ ...args, agent: { chooseAction: async () => ({ attack: { attackerId: 'fake' } }) } })).toBe(false);
  expect(apply).not.toHaveBeenCalled();

  game.player.hand.add(new Card({ type: 'ally', name: 'Scout', cost: 0 }));
  const select = jest.fn(async (_state, actions) => actions.find(a => a.card));
  apply.mockResolvedValueOnce(false);
  expect(await game.runAgentTurn({ ...args, agent: { chooseAction: select } })).toBe(false);
  expect(select).toHaveBeenCalledTimes(1);

  select.mockClear();
  apply.mockImplementationOnce(async () => { game.opponent.hero.data.health = 0; return true; });
  expect(await game.runAgentTurn({ ...args, agent: { chooseAction: select } })).toBe(true);
  expect(select).toHaveBeenCalledTimes(1);
});

test('skipStart avoids resource reset and draw', async () => {
  const game = setup();
  const drawCard = new Card({ type: 'ally', name: 'Drawn', cost: 0 });
  game.player.library.cards = [drawCard];
  const start = jest.spyOn(game.resources, 'startTurn');
  const agent = { chooseAction: async (_state, actions) => actions.find(a => a.end) };
  await game.runAgentTurn({ agent, player: game.player, opponent: game.opponent, skipStart: true });
  expect(start).not.toHaveBeenCalled();
  expect(game.player.library.cards).toContain(drawCard);
  await game.runAgentTurn({ agent, player: game.player, opponent: game.opponent });
  expect(start).toHaveBeenCalledTimes(1);
  expect(game.player.hand.cards).toContain(drawCard);
});
