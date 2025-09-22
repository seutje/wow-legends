// Runtime helper for encoding minions using precomputed embedding vectors.
// We lazily load data/models/embeddinggemma.json (generated offline)
// and expose encodeMinion(minion) -> latent vector.

const DEFAULT_COLUMNS = Object.freeze([
  'attack',
  'health',
  'taunt',
  'rush',
  'charge',
  'stealth',
  'divineShield',
  'windfury',
  'reflect',
  'lifesteal'
]);

const DEFAULT_MAX_HINTS = Object.freeze({
  attack: 20,
  health: 20,
  taunt: 1,
  rush: 1,
  charge: 1,
  stealth: 1,
  divineShield: 1,
  windfury: 1,
  reflect: 1,
  lifesteal: 1,
});

export const DEFAULT_LATENT_SIZE = 20;
const EMBEDDING_MODEL_PATH = '../../../data/models/embeddinggemma.json';

let AutoencoderModel = null;
let LoadPromise = null;
let LoadError = null;

function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function keywordActive(card, keyword) {
  if (!card) return false;
  if (Array.isArray(card.keywords) && card.keywords.includes(keyword)) return true;
  const tempCounts = card?.data?.tempKeywordCounts;
  if (tempCounts && numberOrZero(tempCounts[keyword]) > 0) return true;
  return false;
}

function divineShieldActive(card) {
  if (!card) return false;
  if (card?.data?.divineShield === true) return true;
  if (card?.data?.divineShield === false) return false;
  return keywordActive(card, 'Divine Shield');
}

function extractFeature(card, column) {
  switch (column) {
    case 'attack':
      return numberOrZero(card?.data?.attack ?? card?.attack);
    case 'health':
      return numberOrZero(card?.data?.health ?? card?.health);
    case 'taunt':
      return keywordActive(card, 'Taunt') ? 1 : 0;
    case 'rush':
      return keywordActive(card, 'Rush') ? 1 : 0;
    case 'charge':
      return keywordActive(card, 'Charge') ? 1 : 0;
    case 'stealth':
      return keywordActive(card, 'Stealth') ? 1 : 0;
    case 'divineShield':
      return divineShieldActive(card) ? 1 : 0;
    case 'windfury':
      return keywordActive(card, 'Windfury') ? 1 : 0;
    case 'reflect':
      return keywordActive(card, 'Reflect') ? 1 : 0;
    case 'lifesteal':
      return keywordActive(card, 'Lifesteal') ? 1 : 0;
    default:
      return 0;
  }
}

function minionFeatureVector(minion, columns = DEFAULT_COLUMNS) {
  if (!minion) return columns.map(() => 0);
  return columns.map((col) => extractFeature(minion, col));
}

function fallbackMaxForColumn(column) {
  return DEFAULT_MAX_HINTS[column] || 1;
}

function normalizeFeatures(raw, { columns = DEFAULT_COLUMNS, featureStats = null } = {}) {
  const maxList = featureStats?.max;
  return raw.map((value, idx) => {
    const column = columns[idx] || DEFAULT_COLUMNS[idx] || 'attack';
    const max = (Array.isArray(maxList) && maxList[idx] > 0)
      ? maxList[idx]
      : fallbackMaxForColumn(column);
    return clamp01((value || 0) / max);
  });
}

function defaultNormalized(raw, columns = DEFAULT_COLUMNS) {
  const defaults = columns.map((column) => fallbackMaxForColumn(column));
  const stats = { max: defaults };
  return normalizeFeatures(raw, { columns, featureStats: stats });
}

function fallbackEncode(raw, columns, latentSize = DEFAULT_LATENT_SIZE) {
  const normalized = defaultNormalized(raw, columns);
  const size = Number.isFinite(latentSize) && latentSize > 0
    ? Math.floor(latentSize)
    : DEFAULT_LATENT_SIZE;
  const out = new Array(size).fill(0);
  if (!normalized.length) return out;
  for (let i = 0; i < size; i++) {
    out[i] = normalized[i % normalized.length] || 0;
  }
  return out;
}

function collectEntryIds(entry) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) ids.add(trimmed);
  };
  add(entry?.cardId);
  add(entry?.id);
  add(entry?.heroId);
  if (Array.isArray(entry?.aliases)) {
    for (const alias of entry.aliases) add(alias);
  }
  const meta = entry?.metadata;
  if (meta && typeof meta === 'object') {
    add(meta.cardId);
    add(meta.id);
    add(meta.heroId);
    add(meta.hero);
    if (Array.isArray(meta.aliases)) {
      for (const alias of meta.aliases) add(alias);
    }
  }
  return Array.from(ids);
}

function sanitizeVector(values, sizeHint = 0) {
  const sizeCandidate = Number.isFinite(sizeHint) && sizeHint > 0
    ? Math.floor(sizeHint)
    : (Array.isArray(values) ? values.length : 0);
  const size = sizeCandidate > 0 ? sizeCandidate : DEFAULT_LATENT_SIZE;
  const out = new Array(size).fill(0);
  if (Array.isArray(values)) {
    const n = Math.min(size, values.length);
    for (let i = 0; i < n; i++) {
      const val = Number(values[i]);
      out[i] = Number.isFinite(val) ? val : 0;
    }
  }
  return out;
}

function sanitizeEmbeddingData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Array.isArray(raw.cards) ? raw.cards : [];
  const vectors = new Map();
  let latentSize = Number(raw.dimensions);
  if (!Number.isFinite(latentSize) || latentSize <= 0) latentSize = 0;
  for (const entry of entries) {
    const ids = collectEntryIds(entry);
    if (!ids.length) continue;
    const values = Array.isArray(entry?.vector) ? entry.vector : null;
    if (!values || values.length === 0) continue;
    const candidateSize = latentSize > 0 ? latentSize : values.length;
    const vector = Object.freeze(sanitizeVector(values, candidateSize));
    if (!vector.length) continue;
    if (latentSize <= 0) latentSize = vector.length;
    for (const id of ids) {
      if (!vectors.has(id)) vectors.set(id, vector);
    }
  }
  if (latentSize <= 0) latentSize = DEFAULT_LATENT_SIZE;
  return {
    latentSize,
    columns: DEFAULT_COLUMNS.slice(),
    vectors,
  };
}

async function fetchEmbeddingModel() {
  let data = null;
  if (typeof window === 'undefined') {
    const fs = await import('fs/promises');
    const url = new URL(EMBEDDING_MODEL_PATH, import.meta.url);
    const txt = await fs.readFile(url, 'utf8');
    data = JSON.parse(txt);
  } else {
    const res = await fetch(new URL(EMBEDDING_MODEL_PATH, import.meta.url));
    if (!res.ok) throw new Error(`Failed to fetch embedding model: ${res.status}`);
    data = await res.json();
  }
  const model = sanitizeEmbeddingData(data);
  if (!model) throw new Error('Invalid embedding model file');
  return model;
}

function candidateIdsForCard(card) {
  if (!card) return [];
  const ids = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) ids.add(trimmed);
  };
  add(card?.id);
  add(card?.cardId);
  const data = card?.data;
  if (data && typeof data === 'object') {
    add(data.cardId);
    add(data.id);
    add(data.baseCardId);
    add(data.originalCardId);
  }
  if (Array.isArray(card?.aliases)) {
    for (const alias of card.aliases) add(alias);
  }
  return Array.from(ids);
}

function vectorFromModel(model, card) {
  if (!model?.vectors || !(model.vectors instanceof Map)) return null;
  const ids = candidateIdsForCard(card);
  for (const id of ids) {
    const vec = model.vectors.get(id);
    if (Array.isArray(vec)) return vec;
  }
  return null;
}

export async function loadAutoencoder() {
  if (AutoencoderModel) return AutoencoderModel;
  if (LoadError) throw LoadError;
  if (!LoadPromise) {
    LoadPromise = fetchEmbeddingModel()
      .then((model) => {
        AutoencoderModel = model;
        return model;
      })
      .catch((err) => {
        LoadError = err;
        AutoencoderModel = null;
        throw err;
      });
  }
  return LoadPromise;
}

function getModel() {
  if (AutoencoderModel) return AutoencoderModel;
  return null;
}

export function isAutoencoderLoaded() {
  return !!AutoencoderModel;
}

export function getLatentSize() {
  if (AutoencoderModel?.latentSize) return AutoencoderModel.latentSize;
  return DEFAULT_LATENT_SIZE;
}

export function encodeMinion(minion) {
  const model = getModel();
  const columns = model?.columns || DEFAULT_COLUMNS;
  const raw = minionFeatureVector(minion, columns);
  if (!model) {
    return fallbackEncode(raw, columns);
  }
  const latentSize = model?.latentSize && model.latentSize > 0
    ? model.latentSize
    : DEFAULT_LATENT_SIZE;
  const stored = vectorFromModel(model, minion);
  if (Array.isArray(stored) && stored.length) {
    const copy = stored.slice();
    if (copy.length === latentSize) return copy;
    if (copy.length > latentSize) {
      return copy.slice(0, latentSize);
    }
    const out = new Array(latentSize).fill(0);
    const n = Math.min(latentSize, copy.length);
    for (let i = 0; i < n; i++) out[i] = copy[i];
    return out;
  }
  return fallbackEncode(raw, columns, latentSize);
}

export function resetAutoencoderCache() {
  AutoencoderModel = null;
  LoadPromise = null;
  LoadError = null;
}

export function rawMinionFeatures(minion) {
  return minionFeatureVector(minion, AutoencoderModel?.columns || DEFAULT_COLUMNS);
}
