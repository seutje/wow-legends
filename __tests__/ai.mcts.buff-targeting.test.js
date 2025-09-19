import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import MCTS_AI from '../src/js/systems/ai-mcts.js';

describe('MCTS buff targeting', () => {
  test('Power Word: Shield buffs an ally and records the target', async () => {
    const g = new Game();
    await g.setupMatch();
    const ai = new MCTS_AI({
      resourceSystem: g.resources,
      combatSystem: g.combat,
      game: g,
      iterations: 50,
      rolloutDepth: 1,
    });

    g.turns.turn = 3;
    g.turns.setActivePlayer(g.opponent);
    g.resources._pool.set(g.opponent, 5);

    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.player.graveyard.cards = [];
    g.opponent.hand.cards = [];
    g.opponent.graveyard.cards = [];
    g.opponent.battlefield.cards = [];
    g.opponent.hero.keywords = ['Stealth'];

    const ally = new Card({
      id: 'injured-minion',
      type: 'ally',
      name: 'Injured Ally',
      data: { attack: 3, health: 1, maxHealth: 3, enteredTurn: 0 },
    });
    g.opponent.battlefield.cards = [ally];

    const powerWordData = g.allCards.find((c) => c.id === 'spell-power-word-shield');
    const powerWord = powerWordData
      ? new Card(powerWordData)
      : new Card({
        id: 'spell-power-word-shield',
        type: 'spell',
        name: 'Power Word: Shield',
        cost: 1,
        effects: [
          { type: 'buff', target: 'character', property: 'health', amount: 2, duration: 'untilYourNextTurn' },
        ],
      });

    g.opponent.hand.cards = [powerWord];

    const state = ai._stateFromLive(g.opponent, g.player);
    const actions = ai._legalActions(state);
    const action = actions.find((act) => act.card && act.card.id === powerWord.id);
    expect(action).toBeTruthy();

    const result = ai._applyAction(state, action);
    expect(result.terminal).toBe(false);

    expect(action.__mctsTargetSignature).toMatch('injured-minion');

    const buffed = result.state.player.battlefield.cards.find((c) => c.id === 'injured-minion');
    expect(buffed).toBeTruthy();
    expect(buffed.data.health).toBe(3);
    expect(buffed.data.maxHealth).toBe(5);
    expect(result.state.player.graveyard.cards.some((c) => c.id === powerWord.id)).toBe(true);
  });

  test('Rallying Cry buffs the hero and allies in simulation', async () => {
    const g = new Game();
    await g.setupMatch();
    const ai = new MCTS_AI({
      resourceSystem: g.resources,
      combatSystem: g.combat,
      game: g,
      iterations: 50,
      rolloutDepth: 1,
    });

    g.turns.turn = 4;
    g.turns.setActivePlayer(g.opponent);
    g.resources._pool.set(g.opponent, 5);

    g.player.hand.cards = [];
    g.player.battlefield.cards = [];
    g.player.graveyard.cards = [];
    g.opponent.hand.cards = [];
    g.opponent.graveyard.cards = [];
    g.opponent.battlefield.cards = [];
    g.opponent.hero.data.health = 30;

    const allyA = new Card({
      id: 'buff-ally-a',
      type: 'ally',
      name: 'Buff Ally A',
      data: { attack: 2, health: 2, maxHealth: 2, enteredTurn: 0 },
    });
    const allyB = new Card({
      id: 'buff-ally-b',
      type: 'ally',
      name: 'Buff Ally B',
      data: { attack: 1, health: 1, maxHealth: 1, enteredTurn: 0 },
    });
    g.opponent.battlefield.cards = [allyA, allyB];

    const rallyData = g.allCards.find((c) => c.id === 'spell-rallying-cry');
    const rallyingCry = rallyData
      ? new Card(rallyData)
      : new Card({
        id: 'spell-rallying-cry',
        type: 'spell',
        name: 'Rallying Cry',
        cost: 2,
        effects: [
          { type: 'buff', target: 'allies', property: 'health', amount: 1 },
        ],
      });

    g.opponent.hand.cards = [rallyingCry];

    const state = ai._stateFromLive(g.opponent, g.player);
    const actions = ai._legalActions(state);
    const action = actions.find((act) => act.card && act.card.id === rallyingCry.id);
    expect(action).toBeTruthy();

    const result = ai._applyAction(state, action);
    expect(result.terminal).toBe(false);

    expect(result.state.player.hero.data.health).toBe(31);

    const buffedA = result.state.player.battlefield.cards.find((c) => c.id === 'buff-ally-a');
    const buffedB = result.state.player.battlefield.cards.find((c) => c.id === 'buff-ally-b');
    expect(buffedA?.data.health).toBe(3);
    expect(buffedA?.data.maxHealth).toBe(3);
    expect(buffedB?.data.health).toBe(2);
    expect(buffedB?.data.maxHealth).toBe(2);

    expect(result.state.player.graveyard.cards.some((c) => c.id === rallyingCry.id)).toBe(true);
  });
});
