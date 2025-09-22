#!/usr/bin/env node
// Generate EmbeddingGemma vectors for every card in data/cards/*.json.
//
// By default the script batches requests to an EmbeddingGemma REST endpoint.
// Provide the endpoint via --endpoint or EMBEDDING_GEMMA_URL and, if needed,
// an API key via --api-key / EMBEDDING_GEMMA_API_KEY. The script writes the
// resulting vectors to data/models/embeddinggemma.json so downstream tooling
// can load them similarly to the autoencoder artifact.
//
// Use --mock (or EMBEDDING_GEMMA_MOCK=1) to generate deterministic placeholder
// vectors without calling a backend. This is handy for testing or when the
// embedding service is unavailable.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const CARDS_DIR = path.join(ROOT_DIR, 'data', 'cards');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'models', 'embeddinggemma.json');

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_MODEL = 'embeddinggemma';
const DEFAULT_PAYLOAD_KEY = 'input';
const DEFAULT_MOCK_DIMENSIONS = 256;

function printUsage() {
  console.log(`Usage: node tools/generate-embeddinggemma.mjs [options]\n\n` +
    `Options:\n` +
    `  --endpoint=<url>        REST endpoint for EmbeddingGemma requests.\n` +
    `  --api-key=<key>         API key for Authorization header (optional).\n` +
    `  --batch-size=<n>        Number of cards per request (default ${DEFAULT_BATCH_SIZE}).\n` +
    `  --output=<path>         Output file (default data/models/embeddinggemma.json).\n` +
    `  --model=<name>          Model identifier to include in the payload (default ${DEFAULT_MODEL}).\n` +
    `  --payload-key=<key>     Payload field for the text batch (default "${DEFAULT_PAYLOAD_KEY}").\n` +
    `  --header="K: V"         Extra header to include with the request. Can be repeated.\n` +
    `  --mock                  Generate deterministic placeholder vectors instead of calling a backend.\n` +
    `  --mock-dims=<n>         Vector length in mock mode (default ${DEFAULT_MOCK_DIMENSIONS}).\n` +
    `  --help                  Show this message.\n`);
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const config = {
    endpoint: process.env.EMBEDDING_GEMMA_URL || '',
    apiKey: process.env.EMBEDDING_GEMMA_API_KEY || '',
    batchSize: parsePositiveInt(process.env.EMBEDDING_GEMMA_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
    outputFile: process.env.EMBEDDING_GEMMA_OUTPUT ? path.resolve(process.cwd(), process.env.EMBEDDING_GEMMA_OUTPUT) : OUTPUT_FILE,
    model: process.env.EMBEDDING_GEMMA_MODEL || DEFAULT_MODEL,
    payloadKey: process.env.EMBEDDING_GEMMA_PAYLOAD_KEY || DEFAULT_PAYLOAD_KEY,
    extraHeaders: [],
    mock: parseBoolean(process.env.EMBEDDING_GEMMA_MOCK),
    mockDimensions: parsePositiveInt(process.env.EMBEDDING_GEMMA_MOCK_DIMS) || DEFAULT_MOCK_DIMENSIONS
  };

  for (const token of argv) {
    if (!token) continue;
    if (token === '--help' || token === '-h') {
      config.help = true;
      continue;
    }
    if (token === '--mock') {
      config.mock = true;
      continue;
    }
    if (token.startsWith('--endpoint=')) {
      config.endpoint = token.slice('--endpoint='.length).trim();
      continue;
    }
    if (token.startsWith('--api-key=')) {
      config.apiKey = token.slice('--api-key='.length);
      continue;
    }
    if (token.startsWith('--batch-size=')) {
      const value = parsePositiveInt(token.slice('--batch-size='.length));
      if (value) config.batchSize = value;
      continue;
    }
    if (token.startsWith('--output=')) {
      const target = token.slice('--output='.length);
      if (target) config.outputFile = path.resolve(process.cwd(), target);
      continue;
    }
    if (token.startsWith('--model=')) {
      const model = token.slice('--model='.length).trim();
      if (model) config.model = model;
      continue;
    }
    if (token.startsWith('--payload-key=')) {
      const key = token.slice('--payload-key='.length).trim();
      if (key) config.payloadKey = key;
      continue;
    }
    if (token.startsWith('--header=')) {
      const header = token.slice('--header='.length).trim();
      if (header) config.extraHeaders.push(header);
      continue;
    }
    if (token.startsWith('--mock-dims=')) {
      const dims = parsePositiveInt(token.slice('--mock-dims='.length));
      if (dims) config.mockDimensions = dims;
      continue;
    }
  }

  return config;
}

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseBoolean(value) {
  if (value === undefined) return false;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === '1' || lowered === 'true' || lowered === 'yes';
  }
  return Boolean(value);
}

async function loadCardDefinitions(directory = CARDS_DIR) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const cards = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(directory, entry.name);
    const raw = await fs.readFile(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse ${filePath}: ${err.message}`);
    }
    if (!Array.isArray(parsed)) {
      console.warn(`Skipping ${filePath}: expected an array of cards.`);
      continue;
    }
    for (const card of parsed) {
      if (!card || typeof card !== 'object') continue;
      const cardId = typeof card.id === 'string' ? card.id.trim() : '';
      if (!cardId) continue;
      cards.push(buildCardRecord(card, filePath));
    }
  }
  cards.sort((a, b) => a.cardId.localeCompare(b.cardId));
  return cards;
}

function buildCardRecord(card, filePath) {
  const name = sanitizeString(card.name);
  const text = sanitizeString(card.text);
  const prompt = sanitizeString(card.prompt);
  const type = sanitizeString(card.type);
  const keywords = sanitizeKeywordArray(card.keywords);
  const cost = Number.isFinite(card?.cost) ? Number(card.cost) : null;

  const sections = [];
  if (name) sections.push(`Name: ${name}`);
  if (type || cost !== null) {
    const pieces = [];
    if (type) pieces.push(`Type: ${type}`);
    if (cost !== null) pieces.push(`Cost: ${cost}`);
    if (pieces.length) sections.push(pieces.join(' | '));
  }
  if (keywords.length) sections.push(`Keywords: ${keywords.join(', ')}`);
  if (text) sections.push(`Rules Text: ${text}`);
  if (prompt) sections.push(`Prompt: ${prompt}`);
  const concatenated = sections.join('\n\n').trim();

  const relativePath = path.relative(ROOT_DIR, filePath);
  const textHash = createHash('sha256').update(concatenated, 'utf8').digest('hex');

  const metadata = {
    name: name || null,
    type: type || null,
    cost,
    keywords,
    sourceFile: relativePath,
    textFields: {
      name: name || null,
      text: text || null,
      prompt: prompt || null,
      keywords
    },
    textHash,
    textLength: concatenated.length
  };

  return {
    cardId: card.id,
    text: concatenated,
    metadata
  };
}

function sanitizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function sanitizeKeywordArray(value) {
  if (!Array.isArray(value)) return [];
  const keywords = [];
  for (const kw of value) {
    if (typeof kw !== 'string') continue;
    const trimmed = kw.trim();
    if (!trimmed) continue;
    keywords.push(trimmed);
  }
  return keywords;
}

async function ensureOutputDirectory(filePath) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
}

function buildHeaders(config) {
  const headers = new Map();
  headers.set('Content-Type', 'application/json');
  if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`);
  for (const header of config.extraHeaders) {
    const idx = header.indexOf(':');
    if (idx === -1) {
      console.warn(`Ignoring malformed header: ${header}`);
      continue;
    }
    const name = header.slice(0, idx).trim();
    const value = header.slice(idx + 1).trim();
    if (!name) {
      console.warn(`Ignoring malformed header: ${header}`);
      continue;
    }
    if (!value) {
      console.warn(`Header "${name}" has an empty value; sending empty string.`);
    }
    headers.set(name, value);
  }
  return headers;
}

async function requestBatchEmbeddings(records, config) {
  if (config.mock) {
    return records.map((record) => computeMockEmbedding(record.cardId, record.text, config.mockDimensions));
  }

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable. Use Node.js 18+ or supply --mock.');
  }

  if (!config.endpoint) {
    throw new Error('No EmbeddingGemma endpoint provided. Pass --endpoint or set EMBEDDING_GEMMA_URL.');
  }

  const payload = {};
  if (config.model) payload.model = config.model;
  payload[config.payloadKey] = records.map((record) => record.text);
  payload.cardIds = records.map((record) => record.cardId);

  const headers = Object.fromEntries(buildHeaders(config));
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await safeReadResponseText(response);
    throw new Error(`Embedding request failed (${response.status} ${response.statusText}): ${text}`);
  }

  const data = await response.json();
  const embeddings = normalizeEmbeddingResponse(data, records.length);
  return embeddings;
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch (err) {
    return `<failed to read response body: ${err.message}>`;
  }
}

function normalizeEmbeddingResponse(payload, expected) {
  if (!payload) throw new Error('Empty response from embedding service.');

  const backendError = extractBackendError(payload);
  if (backendError) {
    throw new Error(`Embedding service error: ${backendError}`);
  }

  const candidates = [];
  const pushCandidate = (value) => {
    if (Array.isArray(value)) candidates.push(value);
  };

  pushCandidate(payload);
  pushCandidate(payload?.data);
  pushCandidate(payload?.embeddings);
  pushCandidate(payload?.output);
  pushCandidate(payload?.results);

  if (payload?.embedding !== undefined) {
    candidates.push([payload.embedding]);
  }

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate, expected);
    if (normalized) return normalized;
  }

  const payloadKeys = Object.keys(payload ?? {});
  throw new Error(`Unrecognized embedding response shape${payloadKeys.length ? ` (keys: ${payloadKeys.join(', ')})` : ''}.`);
}

function normalizeCandidate(candidate, expected) {
  if (!Array.isArray(candidate)) return null;

  if (candidate.length === expected) {
    try {
      return candidate.map((item, index) => sanitizeVector(extractVector(item), index));
    } catch (err) {
      // fall through to attempt single-vector handling below
    }
  }

  if (expected === 1 && candidate.length > 0) {
    try {
      const vector = sanitizeVector(extractVector(candidate), 0);
      return [vector];
    } catch (err) {
      // ignore and continue searching
    }
  }

  return null;
}

function extractVector(item) {
  if (!item) return item;
  if (Array.isArray(item)) return item;
  if (Array.isArray(item.values)) return item.values;
  if (Array.isArray(item.vector)) return item.vector;
  if (Array.isArray(item.output)) return item.output;
  if (Array.isArray(item.data)) return item.data;
  if (Array.isArray(item.embedding)) return item.embedding;
  if (Array.isArray(item?.embedding?.values)) return item.embedding.values;
  if (Array.isArray(item?.embedding?.vector)) return item.embedding.vector;
  if (Array.isArray(item?.embedding?.data)) return item.embedding.data;
  if (Array.isArray(item?.representation)) return item.representation;
  return item;
}

function extractBackendError(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  if (payload.error && typeof payload.error === 'object') {
    if (typeof payload.error.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }
    if (typeof payload.error.detail === 'string' && payload.error.detail.trim()) {
      return payload.error.detail.trim();
    }
  }
  if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    const first = payload.errors.find((item) => typeof item === 'string' && item.trim())
      || payload.errors.find((item) => item && typeof item.message === 'string' && item.message.trim());
    if (typeof first === 'string') return first.trim();
    if (first && typeof first.message === 'string' && first.message.trim()) return first.message.trim();
  }
  return '';
}

function sanitizeVector(vector, index) {
  if (!Array.isArray(vector)) {
    throw new Error(`Embedding at index ${index} is not an array.`);
  }
  const sanitized = vector.map((value, column) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Embedding value at position [${index}, ${column}] is not finite.`);
    }
    return numeric;
  });
  return sanitized;
}

function computeMockEmbedding(cardId, text, dimensions = DEFAULT_MOCK_DIMENSIONS) {
  const vector = [];
  let counter = 0;
  while (vector.length < dimensions) {
    const hash = createHash('sha256');
    hash.update(cardId || '');
    hash.update('\n');
    hash.update(text || '');
    hash.update('\n');
    hash.update(String(counter));
    const digest = hash.digest();
    for (let offset = 0; offset <= digest.length - 4 && vector.length < dimensions; offset += 4) {
      const raw = digest.readUInt32BE(offset);
      const normalized = (raw / 0xffffffff) * 2 - 1;
      vector.push(Number.parseFloat(normalized.toFixed(6)));
    }
    counter += 1;
  }
  return vector;
}

async function generateEmbeddings(config) {
  const records = await loadCardDefinitions();
  if (records.length === 0) {
    console.warn('No cards found under data/cards. Nothing to do.');
    return [];
  }

  const output = [];
  for (let i = 0; i < records.length; i += config.batchSize) {
    const batch = records.slice(i, i + config.batchSize);
    const vectors = await requestBatchEmbeddings(batch, config);
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} embeddings, received ${vectors?.length ?? 'unknown'}.`);
    }
    for (let j = 0; j < batch.length; j += 1) {
      const record = batch[j];
      const vector = vectors[j];
      output.push({
        cardId: record.cardId,
        vector,
        metadata: record.metadata
      });
    }
    console.log(`Processed ${Math.min(records.length, i + batch.length)} / ${records.length} cards.`);
  }
  return output;
}

async function writeEmbeddingFile(records, config) {
  const summary = {
    version: 1,
    model: config.model,
    dimensions: Array.isArray(records[0]?.vector) ? records[0].vector.length : null,
    generatedAt: new Date().toISOString(),
    source: config.mock ? 'mock' : config.endpoint || null,
    payloadKey: config.payloadKey,
    batchSize: config.batchSize,
    cards: records
  };
  await ensureOutputDirectory(config.outputFile);
  const serialized = JSON.stringify(summary, null, 2);
  await fs.writeFile(config.outputFile, `${serialized}\n`, 'utf8');
}

export async function main() {
  const config = parseCliArgs();
  if (config.help) {
    printUsage();
    return;
  }

  if (!config.mock && !config.endpoint) {
    console.error('Error: no --endpoint provided and mock mode disabled.');
    console.error('Run with --help to see available options.');
    process.exitCode = 1;
    return;
  }

  try {
    const records = await generateEmbeddings(config);
    if (!records.length) {
      console.warn('Embedding run produced no records. Skipping write.');
      return;
    }
    await writeEmbeddingFile(records, config);
    console.log(`Wrote ${config.outputFile} with ${records.length} embeddings.`);
  } catch (err) {
    console.error('Failed to generate embeddings:');
    console.error(err);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}

export {
  normalizeEmbeddingResponse,
  extractVector,
  extractBackendError
};
