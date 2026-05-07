import { describe, expect, it } from 'vitest';
import {
  buildRetrievalContextSections,
  extractExplicitCitationIndexes,
  selectDisplayedCitations,
  toCitationContentBlocks,
  truncateCitationExcerpt,
} from './retrieval-helpers.js';
import type { RetrievalResponse } from './retrieval-bridge.js';

const retrieval: RetrievalResponse = {
  results: [
    {
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      sourceId: 'source-1',
      content: 'First source content about the product roadmap.',
      score: 0.9,
      metadata: { appKind: 'github' },
      documentTitle: 'Roadmap',
      uri: 'https://example.com/roadmap',
    },
    {
      chunkId: 'chunk-2',
      documentId: 'doc-2',
      sourceId: 'source-2',
      content: 'Second source content about implementation notes.',
      score: 0.8,
      metadata: {},
      documentTitle: 'Implementation Notes',
      uri: null,
    },
  ],
  citations: [],
};

describe('retrieval helpers', () => {
  it('builds prompt sections with title, app label, URI, and content', () => {
    expect(buildRetrievalContextSections(retrieval)[0]).toContain('Title: Roadmap');
    expect(buildRetrievalContextSections(retrieval)[0]).toContain('App: GitHub');
    expect(buildRetrievalContextSections(retrieval)[0]).toContain(
      'URI: https://example.com/roadmap',
    );
  });

  it('extracts explicit citation indexes from assistant text', () => {
    expect(extractExplicitCitationIndexes('See [Source 2] and [Sources 1, 2].')).toEqual([1, 2]);
  });

  it('selects displayed citations only for explicit source references', () => {
    expect(selectDisplayedCitations('No citation here.', retrieval)).toEqual([]);
    expect(selectDisplayedCitations('See [Sources 2, 99].', retrieval)).toEqual([
      expect.objectContaining({
        sourceId: 'source-2',
        documentTitle: 'Implementation Notes',
      }),
    ]);
  });

  it('truncates citation excerpts on word boundaries', () => {
    expect(truncateCitationExcerpt('alpha beta gamma', 12)).toBe('alpha beta');
  });

  it('maps citations to content blocks with the configured shape', () => {
    expect(
      toCitationContentBlocks([
        {
          sourceId: 'source-1',
          chunkId: 'chunk-1',
          documentTitle: 'Roadmap',
          excerpt: 'excerpt',
          score: 0.9,
          uri: null,
        },
      ]),
    ).toEqual([
      {
        type: 'citation',
        sourceId: 'source-1',
        title: 'Roadmap',
        excerpt: 'excerpt',
        uri: null,
        score: 0.9,
      },
    ]);
  });
});
