import { jest } from '@jest/globals';
import Game from '../src/js/game.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';
import TurnSystem from '../src/js/systems/turns.js';
import ResourceSystem from '../src/js/systems/resources.js';
import CombatSystem from '../src/js/systems/combat.js';
import Player from '../src/js/entities/player.js';
import Hero from '../src/js/entities/hero.js';
import Card from '../src/js/entities/card.js';
import { NeuralPolicyValueModel, getActiveModel, setActiveModel } from '../src/js/systems/ai-nn.js';

beforeEach(() => {
  setActiveModel(null);
});

afterEach(() => {
  setActiveModel(null);
});

test('creating MCTS for insane difficulty injects neural policy model', async () => {
  const game = new Game(null);
  const ai = await game._createMctsAI('insane');

  expect(ai).toBeInstanceOf(MCTS_AI);
  expect(ai.iterations).toBe(1000);
  expect(ai.rolloutDepth).toBe(10);
  expect(ai.policyValueModel).toBeInstanceOf(NeuralPolicyValueModel);

  const activeModel = getActiveModel();
  expect(activeModel).toBe(ai.policyValueModel.model);
});

test('insane MCTS falls back to a playable action when policy suggests ending', async () => {
  const turns = new TurnSystem();
  const resources = new ResourceSystem(turns);
  const combat = new CombatSystem();
  const ai = new MCTS_AI({ resourceSystem: resources, combatSystem: combat });
  ai.iterations = 1;
  ai.rolloutDepth = 1;
  ai.policyValueModel = { evaluate: () => ({ stateValue: 0, actionValues: new Map(), policy: new Map() }) };
  const searchSpy = jest.spyOn(ai, '_searchAsync').mockResolvedValue({ end: true });

  const playerHero = new Hero({ name: 'AI Hero', data: { health: 30 } });
  const opponentHero = new Hero({ name: 'Opponent Hero', data: { health: 30 } });
  const player = new Player({ name: 'AI', hero: playerHero });
  const opponent = new Player({ name: 'Opponent', hero: opponentHero });

  const card = new Card({ name: 'Test Ally', type: 'ally', cost: 1, data: { attack: 2, health: 2 } });
  player.hand.cards = [];
  player.hand.add(card);
  player.battlefield.cards = [];
  player.graveyard.cards = [];
  opponent.battlefield.cards = [];
  opponent.graveyard.cards = [];

  turns.setActivePlayer(player);
  turns.turn = 3;
  resources.startTurn(player);

  await ai.takeTurn(player, opponent, { resume: true });

  expect(searchSpy).toHaveBeenCalled();
  expect(player.hand.cards).toHaveLength(0);
  expect(player.battlefield.cards).toHaveLength(1);
  expect(player.battlefield.cards[0].name).toBe('Test Ally');
  expect(player.cardsPlayedThisTurn).toBe(1);

  searchSpy.mockRestore();
});
