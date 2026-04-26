import { describe, expect, it } from 'vitest';
import { SimpleChunkingService } from './chunking.js';
import type { DocumentInput } from './types.js';

function documentWith(content: string, metadata: Record<string, unknown> = {}): DocumentInput {
  return {
    id: 'doc-1',
    sourceId: 'source-1',
    title: 'Test Document',
    content,
    mimeType: 'text/plain',
    metadata,
  };
}

describe('SimpleChunkingService', () => {
  it('returns no chunks for empty content', async () => {
    await expect(new SimpleChunkingService().chunk(documentWith('  \n\n  '))).resolves.toEqual([]);
  });

  it('keeps small documents in one chunk', async () => {
    const chunks = await new SimpleChunkingService().chunk(
      documentWith('Alpha beta\n\nGamma delta', { source: 'unit-test' }),
      32,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      documentId: 'doc-1',
      content: 'Alpha beta\n\nGamma delta',
      index: 0,
      metadata: { source: 'unit-test' },
    });
    expect(chunks[0]?.id).toEqual(expect.any(String));
    expect(chunks[0]?.tokenCount).toBeGreaterThan(0);
  });

  it('splits paragraphs when the estimated token budget is exceeded', async () => {
    const chunks = await new SimpleChunkingService().chunk(
      documentWith('Alpha beta\n\nCharlie delta\n\nEcho foxtrot'),
      3,
      0,
    );

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      'Alpha beta',
      'Charlie delta',
      'Echo foxtrot',
    ]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
    expect(chunks.every((chunk) => chunk.tokenCount <= 3)).toBe(true);
  });

  it('adds overlap from the previous chunk when it fits', async () => {
    const chunks = await new SimpleChunkingService().chunk(
      documentWith('Alpha beta\n\nCharlie delta\n\nEcho foxtrot'),
      4,
      2,
    );

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      'Alpha beta',
      'beta\n\nCharlie delta',
      'delta\n\nEcho foxtrot',
    ]);
    expect(chunks.every((chunk) => chunk.tokenCount <= 4)).toBe(true);
  });

  it('copies document metadata onto every chunk', async () => {
    const metadata = { appKind: 'github', nested: { retained: true } };
    const chunks = await new SimpleChunkingService().chunk(
      documentWith('Alpha beta\n\nCharlie delta', metadata),
      3,
      0,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.metadata)).toEqual([metadata, metadata]);
    expect(chunks[0]?.metadata).not.toBe(metadata);
  });
});
