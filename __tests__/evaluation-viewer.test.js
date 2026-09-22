/** @jest-environment jsdom */
import { readFile } from 'node:fs/promises';
import { createEvaluationViewer } from '../src/js/evaluation/viewer.js';
import { parseDecisionJsonl } from '../src/js/evaluation/data.js';

const loadFixture = async () => {
  const summary = JSON.parse(await readFile(new URL('./fixtures/evaluation-run.json', import.meta.url), 'utf8'));
  const events = parseDecisionJsonl(await readFile(new URL('./fixtures/evaluation-decisions.jsonl', import.meta.url), 'utf8'));
  return { summary, events };
};
const text = root => root.textContent.replace(/\s+/g, ' ');

describe('evaluation viewer UI', () => {
  let root;
  beforeEach(() => { document.body.innerHTML = '<main id="root"></main>'; root = document.querySelector('#root'); });

  test('renders run summary, game list, decisions, state and legal actions', async () => {
    const { summary, events } = await loadFixture();
    createEvaluationViewer(root).load(summary, events);
    expect(text(root)).toContain('jev vs neural-mcts');
    expect(text(root)).toContain('Completed games1');
    expect(text(root)).toContain('Game 1 · seed 123');
    expect(text(root)).toContain('Turn 2 · jev · 2 legal actions');
    expect(text(root)).toContain('Active player');
    expect(text(root)).toContain('Fireball');
    expect(text(root)).toContain('Play Fireball → enemy heroplay-card80.0%25.0%—Jev');
    expect(text(root)).toContain('End turnend-turn20.0%75.0%RecommendedNeural, MCTS');
  });

  test('selects a game and exposes its failed status', async () => {
    const { summary, events } = await loadFixture();
    createEvaluationViewer(root).load(summary, events);
    const game = [...root.querySelectorAll('.games button')].find(button => button.textContent.includes('Error:'));
    game.click();
    expect(text(root)).toContain('This game failed: remote-decision-failed');
  });

  test('filters disagreements and navigates to the next disagreement', async () => {
    const { summary, events } = await loadFixture();
    const viewer = createEvaluationViewer(root); viewer.load(summary, events);
    const filter = root.querySelector('.controls select');
    filter.value = 'disagreements'; filter.dispatchEvent(new Event('change'));
    expect(root.querySelectorAll('.timeline button')).toHaveLength(1);
    expect(text(root.querySelector('.timeline'))).toContain('Play Fireball');
    viewer.state.filter = 'all'; viewer.state.decisionIndex = 1; viewer.load(summary, events); viewer.state.decisionIndex = 1;
    // Reload renders decision zero; click the agreeing second decision, then jump back to disagreement.
    [...root.querySelectorAll('.timeline button')].find(button => button.textContent.includes('Turn 3')).click();
    [...root.querySelectorAll('.navigation button')].find(button => button.textContent === 'Next disagreement').click();
    expect([...root.querySelectorAll('h2')].some(heading => heading.textContent.includes('Turn 2: Play Fireball'))).toBe(true);
  });

  test('marks selections and raw JSON is sanitized', async () => {
    const { summary, events } = await loadFixture();
    events[0].decisionInput.state.apiKey = 'sk-do-not-render';
    events[0].decisionInput.state.headers = { Authorization: 'Bearer secret' };
    createEvaluationViewer(root).load(summary, events);
    const raw = root.querySelector('pre').textContent;
    expect(raw).toContain('[redacted]');
    expect(raw).not.toContain('sk-do-not-render');
    expect(raw).not.toContain('Bearer secret');
    expect(text(root)).toContain('Selected byPlay Fireball');
  });

  test('loads counterfactual estimates into the decision and action table', async () => {
    const { summary, events } = await loadFixture();
    const viewer = createEvaluationViewer(root); viewer.load(summary, events);
    viewer.loadCounterfactuals({ schemaVersion: 1, analysisType: 'counterfactual-mcts-collection',
      sampling: { strategy: 'stratified', eligiblePositions: 20, eligibleMatches: 10,
        sampledMatches: 8, actionTypes: { 'play-card': 1 } }, analyses: [{
      schemaVersion: 1, analysisType: 'counterfactual-mcts', matchId: 'match-1', decisionIndex: 0,
      selectedActionType: 'play-card', evaluator: { iterations: 5000, rolloutDepth: 20, repeats: 3,
        policyGuidance: 'none', baseSeed: 123, informationMode: 'perfect' },
      candidates: [
        { actionId: 'a0', description: 'Play Fireball', selectedBy: ['jev'], estimatedValue: 0.42, stdDev: 0.04, runs: [{}, {}, {}] },
        { actionId: 'a1', description: 'End turn', selectedBy: ['neural'], estimatedValue: 0.18, stdDev: 0.03, runs: [{}, {}, {}] },
      ],
    }] });
    expect(text(root)).toContain('Deep MCTS analysis');
    expect(text(root)).toContain('Sampling strategystratified');
    expect(text(root)).toContain('Matches represented8 / 10');
    expect(text(root)).toContain('Jev-selected action estimated higher+0.24');
    expect(text(root)).toContain('Deep MCTS estimate');
    expect(text(root)).toContain('+0.42 ± 0.04');
    expect(text(root)).toContain('information mode perfect. Jev input mode: player-visible');
  });
});
