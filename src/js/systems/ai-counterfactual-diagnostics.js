const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function addPair(map, left, right, difference, threshold) {
  if (!left || !right || !Number.isFinite(difference)) return;
  const key = `${left}::${right}`;
  if (!map.has(key)) map.set(key, { jevChoice: left, neuralChoice: right, differences: [] });
  map.get(key).differences.push(difference);
}
function finishPairs(map, threshold) {
  return [...map.values()].map(item => ({ jevChoice: item.jevChoice, neuralChoice: item.neuralChoice,
    count: item.differences.length, jevEstimatedHigher: item.differences.filter(value => value > threshold).length,
    neuralEstimatedHigher: item.differences.filter(value => value < -threshold).length,
    ties: item.differences.filter(value => Math.abs(value) <= threshold).length,
    meanValueDifference: mean(item.differences), medianValueDifference: median(item.differences) }))
    .sort((a, b) => b.count - a.count || a.jevChoice.localeCompare(b.jevChoice));
}
function pairMetric(analyses, jevClass, neuralClass, threshold) {
  const values = analyses.filter(item => item.disagreement?.jevChoiceClass === jevClass
    && item.disagreement?.neuralChoiceClass === neuralClass).map(item => {
    const jev = item.candidates.find(candidate => candidate.selectedBy.includes('jev'));
    const neural = item.candidates.find(candidate => candidate.selectedBy.includes('neural'));
    return jev.estimatedValue - neural.estimatedValue;
  });
  return { jevChoice: jevClass, neuralChoice: neuralClass, count: values.length,
    jevEstimatedHigher: values.filter(value => value > threshold).length,
    neuralEstimatedHigher: values.filter(value => value < -threshold).length,
    ties: values.filter(value => Math.abs(value) <= threshold).length,
    medianValueDifference: median(values), meanValueDifference: mean(values) };
}
function averageMetric(candidates, field) {
  const values = candidates.map(candidate => candidate.immediateEffects?.[field]).filter(Number.isFinite);
  return { average: mean(values), samples: values.length };
}

export function aggregateCounterfactualDiagnostics(analyses, { differenceThreshold = 0.05 } = {}) {
  const valid = (analyses || []).filter(item => item && item.status !== 'error');
  const tactical = new Map(); const strategic = new Map();
  for (const analysis of valid) {
    const jev = analysis.candidates?.find(candidate => candidate.selectedBy?.includes('jev'));
    const neural = analysis.candidates?.find(candidate => candidate.selectedBy?.includes('neural'));
    if (!jev || !neural) continue;
    const difference = jev.estimatedValue - neural.estimatedValue;
    addPair(tactical, jev.classification?.primary, neural.classification?.primary, difference, differenceThreshold);
    addPair(strategic, analysis.disagreement?.jevStrategic, analysis.disagreement?.neuralStrategic, difference, differenceThreshold);
  }
  const lethalPositions = valid.filter(item => item.lethal?.lethalAvailable);
  const endTurns = valid.filter(item => item.selectedActionType === 'end-turn' && item.sequencing);
  const heroPowers = valid.filter(item => item.selectedActionType === 'hero-power' && item.sequencing);
  const heroGroups = new Map();
  for (const analysis of heroPowers) {
    const group = analysis.sequencing.neuralAlternativeClass?.startsWith('play-')
      ? analysis.sequencing.neuralAlternativeClass : analysis.sequencing.neuralAlternativeClass?.startsWith('attack-') ? 'attack' : 'other';
    const values = heroGroups.get(group) || []; if (Number.isFinite(analysis.sequencing.valueGap)) values.push(analysis.sequencing.valueGap); heroGroups.set(group, values);
  }
  const jevCandidates = valid.flatMap(item => item.candidates || []).filter(candidate => candidate.selectedBy?.includes('jev'));
  const neuralCandidates = valid.flatMap(item => item.candidates || []).filter(candidate => candidate.selectedBy?.includes('neural'));
  const allCandidates = valid.flatMap(item => item.candidates || []);
  const identical = allCandidates.filter(candidate => candidate.distinctRepeatValues === 1).length;
  return { differenceThreshold,
    tacticalPairs: finishPairs(tactical, differenceThreshold), strategicPairs: finishPairs(strategic, differenceThreshold),
    faceVsTrade: {
      jevFaceNeuralMinion: pairMetric(valid, 'attack-face', 'attack-minion', differenceThreshold),
      jevMinionNeuralFace: pairMetric(valid, 'attack-minion', 'attack-face', differenceThreshold),
      jevFaceNeuralDevelops: pairMetric(valid, 'attack-face', 'play-minion', differenceThreshold),
      jevDevelopsNeuralFace: pairMetric(valid, 'play-minion', 'attack-face', differenceThreshold),
    },
    lethal: { positionsWithLegalLethal: lethalPositions.length,
      jevSelectedLethal: lethalPositions.filter(item => item.lethal.jevSelectedLethal).length,
      neuralSelectedLethal: lethalPositions.filter(item => item.lethal.neuralSelectedLethal).length,
      bothSelectedLethal: lethalPositions.filter(item => item.lethal.jevSelectedLethal && item.lethal.neuralSelectedLethal).length,
      neitherSelectedLethal: lethalPositions.filter(item => !item.lethal.jevSelectedLethal && !item.lethal.neuralSelectedLethal).length,
      jevOnlyLethal: lethalPositions.filter(item => item.lethal.jevSelectedLethal && !item.lethal.neuralSelectedLethal).length,
      neuralOnlyLethal: lethalPositions.filter(item => !item.lethal.jevSelectedLethal && item.lethal.neuralSelectedLethal).length },
    jevEndTurn: { positions: endTurns.length,
      withPlayableCardRemaining: endTurns.filter(item => item.sequencing.hadPlayableCard).length,
      withLegalAttackRemaining: endTurns.filter(item => item.sequencing.hadAvailableAttack).length,
      withHeroPowerRemaining: endTurns.filter(item => item.sequencing.hadHeroPowerAvailable).length,
      withZeroNonEndLegalActions: endTurns.filter(item => item.sequencing.nonEndLegalActionCount === 0).length,
      medianRemainingMana: median(endTurns.map(item => item.sequencing.remainingMana).filter(Number.isFinite)),
      medianValueGap: median(endTurns.map(item => item.sequencing.valueGap).filter(Number.isFinite)) },
    jevHeroPower: { positions: heroPowers.length, alternatives: Object.fromEntries([...heroGroups].map(([key, values]) => [key, {
      count: values.length, jevHigher: values.filter(value => value > differenceThreshold).length,
      neuralHigher: values.filter(value => value < -differenceThreshold).length, medianValueGap: median(values) }])) },
    immediateEffects: { jev: { opponentHeroDamage: averageMetric(jevCandidates, 'opponentHeroDamageImmediate'),
      enemyBoardAttackRemoved: averageMetric(jevCandidates, 'enemyBoardAttackDelta') },
    neural: { opponentHeroDamage: averageMetric(neuralCandidates, 'opponentHeroDamageImmediate'),
      enemyBoardAttackRemoved: averageMetric(neuralCandidates, 'enemyBoardAttackDelta') } },
    repeatStability: { candidates: allCandidates.length, identicalRepeatValues: identical,
      differingRepeatValues: allCandidates.length - identical,
      percentDeterministic: allCandidates.length ? identical / allCandidates.length : null } };
}
