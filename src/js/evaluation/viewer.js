import { actionRows, aggregateComparisons, decisionAgreement, jensenShannonDivergence,
  normalizeEvaluationRun, parseDecisionJsonl, parseEvaluationJson, probabilityComparison,
  sanitizeForDisplay } from './data.js';

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const number = (value, suffix = '') => Number.isFinite(value) ? `${value.toFixed(value < 10 ? 2 : 1)}${suffix}` : '—';
const agentForSide = (run, side) => run.config?.[`agent${side}`] || run.agents?.[side]?.id || side;

function metric(label, value) { const node = el('div', 'metric'); node.append(el('span', 'muted', label), el('b', '', value)); return node; }
function card(cardData) {
  const node = el('div', 'analysis-card');
  node.append(el('b', '', cardData?.name || 'Unknown card'));
  const stats = [cardData?.cost != null ? `${cardData.cost} mana` : null,
    cardData?.attack != null || cardData?.health != null ? `${cardData.attack ?? 0} / ${cardData.health ?? '?'}` : null].filter(Boolean).join(' · ');
  if (stats) node.append(el('small', '', stats));
  const text = cardData?.text || cardData?.effects?.join('; ') || cardData?.keywords?.join(', ');
  if (text) node.append(el('small', '', text));
  return node;
}
function stateSide(title, side, own) {
  const node = el('section', 'state-side'); node.append(el('h4', '', title));
  const hero = side?.hero || {};
  node.append(el('p', '', `${hero.name || 'Hero'} · ${hero.health ?? '?'} health · ${hero.armor ?? 0} armor`));
  if (hero.text || hero.effects?.length) node.append(el('p', 'muted', `Hero power: ${hero.text || hero.effects.join('; ')}`));
  if (own && side?.resources) node.append(el('p', 'muted', `Resources ${side.resources.current ?? '?'} / ${side.resources.maximum ?? '?'}`));
  node.append(el('h4', '', 'Board'));
  const board = el('div', 'cards'); (side?.board || []).forEach(item => board.append(card(item)));
  if (!board.childElementCount) board.append(el('span', 'muted', 'Empty'));
  node.append(board);
  if (own) {
    node.append(el('h4', '', `Hand (${side?.handCount ?? side?.hand?.length ?? 0})`));
    const hand = el('div', 'cards'); (side?.hand || []).forEach(item => hand.append(card(item)));
    if (!hand.childElementCount) hand.append(el('span', 'muted', 'Empty'));
    node.append(hand);
  } else node.append(el('p', 'muted', `Hand: ${side?.handCount ?? '?'} cards · Library: ${side?.libraryCount ?? '?'} cards`));
  return node;
}

export function createEvaluationViewer(root) {
  const state = { run: null, gameIndex: 0, decisionIndex: 0, filter: 'all', gameFilter: 'all', search: '', sort: 'selected' };
  const api = { load(summary, decisions = null) { state.run = normalizeEvaluationRun(summary, decisions); state.gameIndex = 0; state.decisionIndex = 0; render(); return state.run; }, state };

  function filteredGames() {
    const games = state.run.games;
    return games.filter(game => {
      if (state.gameFilter === 'completed' && game.status !== 'completed') return false;
      const jevSide = game.agentA === 'jev' ? 'A' : game.agentB === 'jev' ? 'B' : null;
      if (state.gameFilter === 'jev-wins' && game.winner !== jevSide) return false;
      if (state.gameFilter === 'jev-losses' && (!jevSide || !game.winner || game.winner === jevSide || game.winner === 'draw')) return false;
      if (state.gameFilter === 'jev-first' && game.startingPlayer !== jevSide) return false;
      if (state.gameFilter === 'jev-second' && game.startingPlayer === jevSide) return false;
      return true;
    });
  }
  function filteredDecisions(game) {
    return (game?.decisionEvents || []).filter(event => {
      const agreement = decisionAgreement(event);
      if (state.filter === 'agreements' && agreement !== true) return false;
      if (state.filter === 'disagreements' && agreement !== false) return false;
      if (state.filter === 'jev' && event.agent !== 'jev') return false;
      if (state.filter === 'jev-mcts' && (!event.mctsComparison || event.mctsComparison.agreement)) return false;
      if (state.filter === 'attack' && event.selectedActionType !== 'attack') return false;
      if (state.filter === 'play-card' && !event.selectedActionType?.startsWith('play-card')) return false;
      const haystack = [event.agent, event.description, event.selectedActionType,
        ...(event.decisionInput?.actions || []).map(action => action.description)].join(' ').toLowerCase();
      return !state.search || haystack.includes(state.search.toLowerCase());
    });
  }
  function selectDecision(game, event) {
    state.gameIndex = state.run.games.indexOf(game);
    state.decisionIndex = game.decisionEvents.indexOf(event);
    render();
  }
  function moveDisagreement(direction) {
    const all = state.run.games.flatMap(game => game.decisionEvents.map(event => ({ game, event })))
      .filter(item => decisionAgreement(item.event) === false);
    const game = state.run.games[state.gameIndex]; const event = game?.decisionEvents[state.decisionIndex];
    const current = all.findIndex(item => item.game === game && item.event === event);
    if (!all.length) return;
    const next = all[(current + direction + all.length) % all.length]; selectDecision(next.game, next.event);
  }
  function render() {
    root.replaceChildren();
    if (!state.run) return;
    const run = state.run; const viewer = el('div', 'viewer');
    const summary = el('section', 'panel'); summary.append(el('h2', '', `${run.config?.agentA || 'A'} vs ${run.config?.agentB || 'B'}`));
    const metrics = el('div', 'summary-grid');
    metrics.append(metric('Completed games', run.completedGames ?? run.games.filter(game => game.status === 'completed').length),
      metric('Failed games', run.failedGames ?? run.games.filter(game => game.status === 'error').length));
    for (const side of ['A', 'B']) { const stats = run.agents?.[side]; if (stats) { metrics.append(metric(`${stats.id} wins`, stats.wins ?? '—'), metric(`${stats.id} decisions`, stats.decisions ?? '—'), metric(`${stats.id} latency`, number(stats.avgDecisionLatencyMs, ' ms'))); if (Number.isFinite(stats.cost)) metrics.append(metric(`${stats.id} cost`, stats.cost)); } }
    const aggregate = aggregateComparisons(run.decisionEvents);
    metrics.append(metric('Compared decisions', aggregate.compared), metric('Agreement', aggregate.compared ? percent(aggregate.agreements / aggregate.compared) : '—'),
      metric('Average JS divergence', number(aggregate.averageJensenShannon)));
    for (const side of ['A', 'B']) { const position = run.startingPosition?.[side]; if (position) metrics.append(metric(`${agentForSide(run, side)} first`, `${position.wins ?? 0} / ${position.games ?? 0}`)); }
    summary.append(metrics);
    if (aggregate.compared) { const types = el('div', 'config'); for (const [type, values] of Object.entries(aggregate.actionTypes)) types.append(el('span', 'chip', `${type}: ${values.agreements} agree / ${values.disagreements} disagree`)); summary.append(types); }
    const config = el('div', 'config'); for (const [key, value] of Object.entries(run.config || {})) if (value != null && typeof value !== 'object') config.append(el('span', 'chip', `${key}: ${value}`)); summary.append(config); viewer.append(summary);
    const workspace = el('div', 'workspace'); const gamePanel = el('section', 'panel'); gamePanel.append(el('h3', '', 'Games'));
    const gameSelect = document.createElement('select'); gameSelect.innerHTML = '<option value="all">All games</option><option value="completed">Without errors</option><option value="jev-wins">Jev wins</option><option value="jev-losses">Jev losses</option><option value="jev-first">Jev first</option><option value="jev-second">Jev second</option>'; gameSelect.value = state.gameFilter; gameSelect.onchange = () => { state.gameFilter = gameSelect.value; render(); }; gamePanel.append(gameSelect);
    const gamesNode = el('div', 'games');
    filteredGames().forEach(game => { const jevSide = game.agentA === 'jev' ? 'A' : game.agentB === 'jev' ? 'B' : null; const position = jevSide ? ` · Jev ${game.startingPlayer === jevSide ? 'first' : 'second'}` : ''; const button = el('button', 'list-button', `Game ${game.index + 1} · seed ${game.seed}${position}\n${game.status === 'error' ? `Error: ${game.errorType || 'failed'}` : `Winner: ${game.winner ? agentForSide(run, game.winner) : '—'} · ${game.turns ?? '?'} turns`}`); button.setAttribute('aria-current', game.index === state.gameIndex); button.onclick = () => { state.gameIndex = game.index; state.decisionIndex = 0; render(); }; gamesNode.append(button); }); gamePanel.append(gamesNode); workspace.append(gamePanel);
    const timelinePanel = el('section', 'panel'); timelinePanel.append(el('h3', '', 'Decision timeline'));
    const controls = el('div', 'controls'); const filter = document.createElement('select'); filter.innerHTML = '<option value="all">All decisions</option><option value="disagreements">Disagreements only</option><option value="agreements">Agreements only</option><option value="jev">Jev decisions only</option><option value="jev-mcts">Jev ≠ MCTS</option><option value="attack">Attacks</option><option value="play-card">Card plays</option>'; filter.value = state.filter; filter.onchange = () => { state.filter = filter.value; render(); }; const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search cards, actions, agents…'; search.value = state.search; search.onchange = () => { state.search = search.value; render(); }; controls.append(filter, search); timelinePanel.append(controls);
    const game = run.games[state.gameIndex] || run.games[0]; const decisions = filteredDecisions(game); const timeline = el('div', 'timeline'); decisions.slice(0, 500).forEach(event => { const agreement = decisionAgreement(event); const neuralId = event.neuralComparison?.topActionId; const neuralAction = (event.legalActions || event.decisionInput?.actions)?.find(action => action.id === neuralId); const button = el('button', 'list-button'); button.setAttribute('aria-current', game.decisionEvents.indexOf(event) === state.decisionIndex); button.append(el('b', '', `Turn ${event.turn} · ${event.agent} · ${event.legalActionCount} legal actions`), el('div', '', `Chosen: ${event.description || event.selectedActionId}`)); if (neuralAction) button.append(el('div', 'muted', `Neural: ${neuralAction.description}`)); if (agreement !== null) button.append(el('span', agreement ? 'badge badge--agree' : 'badge badge--disagree', agreement ? 'AGREE' : 'DISAGREE')); button.onclick = () => selectDecision(game, event); timeline.append(button); }); if (!decisions.length) timeline.append(el('p', 'muted', 'No decisions match these filters.')); timelinePanel.append(timeline); workspace.append(timelinePanel); viewer.append(workspace);
    const event = game?.decisionEvents[state.decisionIndex] || decisions[0]; if (event) viewer.append(renderDecision(game, event)); else viewer.append(el('section', 'panel', game?.status === 'error' ? `This game failed: ${game.errorType || 'unknown error'}` : 'No decision events were exported for this game.'));
    root.append(viewer);
  }
  function renderDecision(game, event) {
    const wrap = el('section', 'panel'); const agreement = decisionAgreement(event); const header = el('div'); header.append(el('h2', '', `Turn ${event.turn}: ${event.description || event.selectedActionId}`)); if (agreement !== null) header.append(el('span', agreement ? 'badge badge--agree' : 'badge badge--disagree', agreement ? 'Agreement' : 'Disagreement')); wrap.append(header);
    const navigation = el('div', 'navigation'); for (const [label, fn] of [['← Previous', -1], ['Next →', 1]]) { const b = el('button', '', label); b.onclick = () => { const list = game.decisionEvents; state.decisionIndex = (state.decisionIndex + fn + list.length) % list.length; render(); }; navigation.append(b); } const previous = el('button', '', 'Previous disagreement'); previous.onclick = () => moveDisagreement(-1); const next = el('button', '', 'Next disagreement'); next.onclick = () => moveDisagreement(1); navigation.append(previous, next); wrap.append(navigation);
    const outcome = el('p', 'muted', `Game result: ${game.winner ? agentForSide(state.run, game.winner) : game.status} · ${Math.max(0, (game.turns || event.turn) - event.turn)} turns after this decision`); wrap.append(outcome);
    if (!event.decisionInput) { wrap.append(el('div', 'error-banner', 'This legacy decision has no serialized position or legal-action snapshot. Choice metadata remains available.')); return wrap; }
    const layout = el('div', 'decision-layout'); const position = el('div'); position.append(el('h3', '', 'Player-visible position')); const columns = el('div', 'state-columns'); columns.append(stateSide('Active player', event.decisionInput.state?.player, true), stateSide('Opponent', event.decisionInput.state?.opponent, false)); position.append(columns); const raw = document.createElement('details'); raw.append(el('summary', '', 'Agent reasoning inputs (raw JSON)')); const pre = el('pre', '', JSON.stringify(sanitizeForDisplay(event.decisionInput), null, 2)); raw.append(pre); position.append(raw); layout.append(position);
    const comparison = el('div'); comparison.append(el('h3', '', 'Legal actions')); const pc = probabilityComparison(event); const divergence = jensenShannonDivergence(event); const facts = el('div', 'metric-grid'); if (pc.jevChoice) facts.append(metric("NN probability on Jev's choice", percent(pc.jevChoice.neural))); if (pc.neuralChoice) facts.append(metric("Jev probability on NN's choice", percent(pc.neuralChoice.jev))); if (pc.topChoiceGap !== null) facts.append(metric('Jev top-choice gap', percent(pc.topChoiceGap))); if (divergence !== null) facts.append(metric('JS divergence', number(divergence))); comparison.append(facts);
    const sort = document.createElement('select'); sort.innerHTML = '<option value="selected">Selected, then Jev</option><option value="jev">Jev probability</option><option value="neural">Neural policy</option><option value="mcts">MCTS metric</option><option value="type">Action type</option><option value="original">Original order</option>'; sort.value = state.sort; sort.onchange = () => { state.sort = sort.value; render(); }; comparison.append(sort);
    let rows = actionRows(event); const score = row => row.mcts?.visits ?? row.mcts?.value ?? -Infinity; rows = [...rows].sort((a, b) => state.sort === 'original' ? a.originalIndex - b.originalIndex : state.sort === 'type' ? a.type.localeCompare(b.type) : state.sort === 'neural' ? (b.neuralProbability ?? -1) - (a.neuralProbability ?? -1) : state.sort === 'mcts' ? score(b) - score(a) : state.sort === 'jev' ? (b.jevProbability ?? -1) - (a.jevProbability ?? -1) : Number(b.selectedByAgent || b.selectedByNeural || b.selectedByMcts) - Number(a.selectedByAgent || a.selectedByNeural || a.selectedByMcts) || (b.jevProbability ?? -1) - (a.jevProbability ?? -1));
    const hasJev = rows.some(row => row.jevProbability !== null); const hasNeural = rows.some(row => row.neuralProbability !== null); const hasNeuralValue = rows.some(row => row.neuralValue !== null); const hasMcts = rows.some(row => row.mcts) || !!event.mctsComparison;
    const actionColumns = [{ label: 'Action', cell: row => el('td', '', row.description) }, { label: 'Type', cell: row => el('td', '', row.type) }];
    const probCell = (value, kind) => { const td = document.createElement('td'); const content = el('div', 'probability'); content.append(el('span', '', percent(value))); const bar = el('span', `bar ${kind === 'jev' ? 'bar--jev' : ''}`); const fill = document.createElement('i'); fill.style.width = `${Math.max(0, Math.min(1, value || 0)) * 100}%`; bar.append(fill); content.append(bar); td.append(content); return td; };
    if (hasJev) actionColumns.push({ label: 'Jev probability', cell: row => probCell(row.jevProbability, 'jev') });
    if (hasNeural) actionColumns.push({ label: 'Neural policy', cell: row => probCell(row.neuralProbability, 'neural') });
    if (hasNeuralValue) actionColumns.push({ label: 'NN value', cell: row => el('td', '', number(row.neuralValue)) });
    if (hasMcts) actionColumns.push({ label: 'MCTS metrics', cell: row => el('td', '', row.mcts ? JSON.stringify(row.mcts) : row.selectedByMcts ? 'Recommended' : '—') });
    actionColumns.push({ label: 'Selected by', cell: row => { const markers = [row.selectedByJev ? 'Jev' : null, row.selectedByAgent && !row.selectedByJev ? event.agent : null, row.selectedByNeural ? 'Neural' : null, row.selectedByMcts ? 'MCTS' : null].filter(Boolean); return el('td', 'selection-tags', markers.join(', ') || '—'); } });
    const tableWrap = el('div', 'action-table-wrap'); const table = document.createElement('table'); const head = document.createElement('thead'); const hr = document.createElement('tr'); actionColumns.forEach(column => hr.append(el('th', '', column.label))); head.append(hr); table.append(head); const body = document.createElement('tbody'); const details = el('div', 'action-details hidden'); rows.forEach(row => { const tr = el('tr', 'action-row'); actionColumns.forEach(column => tr.append(column.cell(row))); tr.onclick = () => { body.querySelectorAll('tr').forEach(item => item.setAttribute('aria-selected', 'false')); tr.setAttribute('aria-selected', 'true'); details.classList.remove('hidden'); details.textContent = `ID: ${row.id}\nSignature: ${row.signature || '—'}\nType: ${row.type}\n${row.description}\nJev: ${percent(row.jevProbability)} · Neural policy: ${percent(row.neuralProbability)} · NN value: ${number(row.neuralValue)}${row.mcts ? ` · MCTS: ${JSON.stringify(row.mcts)}` : ''}`; }; body.append(tr); }); table.append(body); tableWrap.append(table); comparison.append(tableWrap, details); layout.append(comparison); wrap.append(layout); return wrap;
  }
  document.addEventListener('keydown', event => { if (!state.run || !['ArrowLeft', 'ArrowRight'].includes(event.key) || /INPUT|SELECT/.test(event.target.tagName)) return; const game = state.run.games[state.gameIndex]; if (!game?.decisionEvents.length) return; state.decisionIndex = (state.decisionIndex + (event.key === 'ArrowRight' ? 1 : -1) + game.decisionEvents.length) % game.decisionEvents.length; render(); });
  return api;
}

export async function loadEvaluationFiles(files) {
  const list = [...files]; const summaryFile = list.find(file => file.name.toLowerCase().endsWith('.json'));
  const decisionsFile = list.find(file => file.name.toLowerCase().endsWith('.jsonl'));
  if (!summaryFile) throw new Error('Select an evaluation summary JSON file.');
  const summary = parseEvaluationJson(await summaryFile.text());
  const decisions = decisionsFile ? parseDecisionJsonl(await decisionsFile.text()) : null;
  return { summary, decisions };
}

export function initializeEvaluationViewer(doc = document) {
  const root = doc.querySelector('#evaluation-root'); if (!root) return null;
  const viewer = createEvaluationViewer(root);
  const inputs = doc.querySelectorAll('#evaluation-files, [data-evaluation-files]');
  const handle = async event => { try { const data = await loadEvaluationFiles(event.target.files); viewer.load(data.summary, data.decisions); } catch (error) { root.innerHTML = ''; root.append(el('div', 'error-banner', error.message)); } };
  inputs.forEach(input => input.addEventListener('change', handle)); return viewer;
}

if (typeof document !== 'undefined') initializeEvaluationViewer();
