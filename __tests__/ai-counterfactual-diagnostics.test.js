import { aggregateCounterfactualDiagnostics } from '../src/js/systems/ai-counterfactual-diagnostics.js';

const analysis = (jevClass, neuralClass, difference, extra = {}) => ({
  selectedActionType: jevClass, disagreement: { jevChoiceClass: jevClass, neuralChoiceClass: neuralClass,
    jevStrategic: jevClass === 'attack-face' ? 'face-pressure' : jevClass === 'attack-minion' ? 'board-control' : 'development',
    neuralStrategic: neuralClass === 'attack-face' ? 'face-pressure' : neuralClass === 'attack-minion' ? 'board-control' : 'development' },
  candidates: [
    { selectedBy: ['jev'], estimatedValue: difference, distinctRepeatValues: 1,
      immediateEffects: { opponentHeroDamageImmediate: jevClass === 'attack-face' ? 3 : 0, enemyBoardAttackDelta: jevClass === 'attack-minion' ? 2 : 0 } },
    { selectedBy: ['neural'], estimatedValue: 0, distinctRepeatValues: 2,
      immediateEffects: { opponentHeroDamageImmediate: neuralClass === 'attack-face' ? 3 : 0, enemyBoardAttackDelta: neuralClass === 'attack-minion' ? 2 : 0 } },
  ], lethal: { lethalAvailable: false }, ...extra,
});

describe('counterfactual tactical diagnostics', () => {
  test('aggregates tactical and strategic choice pairs', () => {
    const result = aggregateCounterfactualDiagnostics([
      analysis('attack-face', 'attack-minion', 4), analysis('attack-face', 'attack-minion', -2),
      analysis('attack-face', 'play-minion', 3), analysis('attack-minion', 'attack-face', -5),
    ]);
    expect(result.faceVsTrade.jevFaceNeuralMinion).toMatchObject({ count: 2, jevEstimatedHigher: 1, neuralEstimatedHigher: 1, medianValueDifference: 1 });
    expect(result.faceVsTrade.jevMinionNeuralFace).toMatchObject({ count: 1, neuralEstimatedHigher: 1 });
    expect(result.strategicPairs.find(pair => pair.jevChoice === 'face-pressure' && pair.neuralChoice === 'board-control')).toMatchObject({ count: 2 });
  });

  test('aggregates lethal, sequencing, immediate effects, and repeat stability', () => {
    const end = analysis('end-turn', 'play-minion', -2, { selectedActionType: 'end-turn',
      sequencing: { hadPlayableCard: true, hadAvailableAttack: true, hadHeroPowerAvailable: true,
        nonEndLegalActionCount: 3, remainingMana: 4, valueGap: -2 },
      lethal: { lethalAvailable: true, jevSelectedLethal: false, neuralSelectedLethal: true } });
    const power = analysis('hero-power', 'play-card-and-hero-power', -1, { selectedActionType: 'hero-power',
      sequencing: { neuralAlternativeClass: 'play-card-and-hero-power', valueGap: -1 },
      lethal: { lethalAvailable: false } });
    const result = aggregateCounterfactualDiagnostics([end, power]);
    expect(result.jevEndTurn).toMatchObject({ positions: 1, withPlayableCardRemaining: 1,
      withLegalAttackRemaining: 1, withHeroPowerRemaining: 1, medianRemainingMana: 4, medianValueGap: -2 });
    expect(result.jevHeroPower.alternatives['play-card-and-hero-power']).toMatchObject({ count: 1, neuralHigher: 1 });
    expect(result.lethal).toMatchObject({ positionsWithLegalLethal: 1, neuralOnlyLethal: 1 });
    expect(result.immediateEffects.jev.opponentHeroDamage.samples).toBe(2);
    expect(result.repeatStability).toMatchObject({ candidates: 4, identicalRepeatValues: 2, differingRepeatValues: 2 });
  });
});
