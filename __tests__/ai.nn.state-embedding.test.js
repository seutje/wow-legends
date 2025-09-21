import { beforeAll, describe, expect, test } from '@jest/globals';
import Game from '../src/js/game.js';
import Card from '../src/js/entities/card.js';
import { stateFeatures, HERO_ID_VOCAB } from '../src/js/systems/ai-nn.js';
import {
  getLatentSize,
  loadAutoencoder,
  resetAutoencoderCache,
  rawMinionFeatures,
} from '../src/js/systems/autoencoder.js';

const BASE_FEATURE_COUNT = 20;

beforeAll(async () => {
  resetAutoencoderCache();
  try {
    await loadAutoencoder();
  } catch {
    // Tests continue with fallback encoder; differences should still appear.
  }
});

function featuresFor(game) {
  return stateFeatures({
    kind: 'live',
    game,
    resources: game.resources,
    player: game.player,
    opponent: game.opponent,
    powerAvailable: false,
  });
}

describe('state feature encoding with autoencoder', () => {
  test('raw minion features include charge keyword signal', () => {
    const base = new Card({ id: 'minion-base', name: 'Runner', type: 'ally', data: { attack: 3, health: 3 } });
    const charger = new Card({
      id: 'minion-charge',
      name: 'Sprinter',
      type: 'ally',
      data: { attack: 3, health: 3 },
      keywords: ['Charge'],
    });
    const baseVec = rawMinionFeatures(base);
    const chargeVec = rawMinionFeatures(charger);
    expect(chargeVec.length).toBe(baseVec.length);
    const differing = [];
    for (let i = 0; i < chargeVec.length; i++) {
      if (chargeVec[i] !== baseVec[i]) {
        differing.push(i);
        expect(chargeVec[i]).toBe(1);
        expect(baseVec[i]).toBe(0);
      }
    }
    expect(differing.length).toBeGreaterThanOrEqual(1);
  });

  test('encoded latent sums respond to different minion compositions', async () => {
    const game = new Game();
    await game.setupMatch();
    game.player.battlefield.cards = [];
    game.opponent.battlefield.cards = [];
    const a = new Card({ id: 'minion-a', name: 'Sentinel', type: 'ally', data: { attack: 3, health: 3 }, keywords: ['Taunt'] });
    const b = new Card({ id: 'minion-b', name: 'Siphoner', type: 'ally', data: { attack: 2, health: 4 }, keywords: ['Lifesteal'] });
    a.owner = game.player;
    b.owner = game.player;
    game.player.battlefield.add(a);
    game.player.battlefield.add(b);

    const baseline = featuresFor(game);

    const c = new Card({
      id: 'minion-c',
      name: 'Bladewhirler',
      type: 'ally',
      data: { attack: 5, health: 2 },
      keywords: ['Rush', 'Reflect']
    });
    c.owner = game.player;
    game.player.battlefield.cards = [a, c];

    const mutated = featuresFor(game);
    expect(mutated.length).toBe(baseline.length);

    const heroVecSize = HERO_ID_VOCAB.length + 1;
    const latentSize = getLatentSize();
    const latentStart = BASE_FEATURE_COUNT + heroVecSize * 2;
    const latentEnd = latentStart + latentSize;
    const playerLatentChanged = mutated
      .slice(latentStart, latentEnd)
      .some((value, idx) => Math.abs(value - baseline[latentStart + idx]) > 1e-6);
    expect(playerLatentChanged).toBe(true);
  });

  test('hand dictionary vector distinguishes different card mixes', async () => {
    const game = new Game();
    await game.setupMatch();
    game.player.battlefield.cards = [];
    game.opponent.battlefield.cards = [];

    const alpha = new Card({ id: 'hand-alpha', name: 'Alpha Bolt', type: 'spell', cost: 1, data: {} });
    const beta = new Card({ id: 'hand-beta', name: 'Beta Brew', type: 'spell', cost: 2, data: {} });
    game.player.hand.cards = [];
    game.player.hand.add(alpha);
    game.player.hand.add(beta);

    const first = featuresFor(game);

    const gamma = new Card({ id: 'hand-gamma', name: 'Gamma Gale', type: 'spell', cost: 3, data: {} });
    const delta = new Card({ id: 'hand-delta', name: 'Delta Dash', type: 'spell', cost: 4, data: {} });
    game.player.hand.cards = [];
    game.player.hand.add(gamma);
    game.player.hand.add(delta);

    const second = featuresFor(game);
    expect(second.length).toBe(first.length);

    const heroVecSize = HERO_ID_VOCAB.length + 1;
    const latentSize = getLatentSize();
    const handVectorLength = (first.length - BASE_FEATURE_COUNT - heroVecSize * 2 - latentSize * 2) / 2;
    expect(Number.isInteger(handVectorLength)).toBe(true);
    const handStart = BASE_FEATURE_COUNT + heroVecSize * 2 + latentSize * 2;
    const handEnd = handStart + handVectorLength;
    const handChanged = second
      .slice(handStart, handEnd)
      .some((value, idx) => Math.abs(value - first[handStart + idx]) > 1e-6);
    expect(handChanged).toBe(true);
  });
});
