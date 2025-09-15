import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';

test('Ice Lance freeze fades after one full turn', async () => {
  const g = new Game();
  await g.setupMatch();

  // Ensure opponent is the active player to cast Ice Lance at the player hero
  g.turns.setActivePlayer(g.opponent);
  g.turns.turn = 2; // ensure at least 2 resources available
  g.turns.startTurn();
  g.resources.startTurn(g.opponent);

  // Add Ice Lance to opponent hand and target our hero
  const iceLanceData = g.allCards.find(c => c.id === 'spell-ice-lance');
  const iceLance = new Card(iceLanceData);
  g.opponent.hand.add(iceLance);
  g.promptTarget = async () => g.player.hero;

  // Opponent casts Ice Lance at our hero
  await g.playFromHand(g.opponent, iceLance.id);
  expect(g.player.hero.data.freezeTurns).toBe(1);

  // Finish opponent's turn; freeze should not tick down on our hero yet
  while (g.turns.current !== 'End') g.turns.nextPhase();
  g.turns.nextPhase(); // End -> Start

  // Start player's turn; still frozen during this turn
  g.turns.setActivePlayer(g.player);
  g.turns.startTurn();
  g.resources.startTurn(g.player);
  expect(g.player.hero.data.freezeTurns).toBe(1);

  // End the player's turn; freeze should expire now
  while (g.turns.current !== 'End') g.turns.nextPhase();
  g.turns.nextPhase(); // End -> Start
  expect(g.player.hero.data.freezeTurns).toBe(0);
});

