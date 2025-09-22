import { normalizeEmbeddingResponse } from '../tools/generate-embeddinggemma.mjs';

describe('normalizeEmbeddingResponse', () => {
  it('normalizes embeddings contained in nested values arrays', () => {
    const payload = {
      data: [
        { embedding: { values: [0.1, 0.2, 0.3] } },
        { embedding: { values: [0.4, 0.5, 0.6] } }
      ]
    };

    const normalized = normalizeEmbeddingResponse(payload, 2);

    expect(normalized).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    ]);
  });

  it('handles single-vector embedding payloads', () => {
    const payload = {
      embedding: [1, 2, 3]
    };

    const normalized = normalizeEmbeddingResponse(payload, 1);

    expect(normalized).toEqual([[1, 2, 3]]);
  });

  it('throws a helpful error when backend returns an error field', () => {
    expect(() => normalizeEmbeddingResponse({ error: 'model not found' }, 1))
      .toThrow('Embedding service error: model not found');
  });

  it('throws when the response does not contain embeddings', () => {
    expect(() => normalizeEmbeddingResponse({ model: 'foo', embeddings: [] }, 1))
      .toThrow('Unrecognized embedding response shape');
  });
});
