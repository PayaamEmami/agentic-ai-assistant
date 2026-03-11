import type { SearchResult, CitationRef } from './types.js';

export interface CitationService {
  assembleCitations(results: SearchResult[]): Promise<CitationRef[]>;
}

export class CitationServiceImpl implements CitationService {
  async assembleCitations(results: SearchResult[]): Promise<CitationRef[]> {
    // TODO: look up source metadata and format citations
    return results.map(r => ({
      sourceId: r.sourceId,
      chunkId: r.chunkId,
      documentTitle: '',
      excerpt: r.content.slice(0, 200),
      score: r.score,
      uri: null,
    }));
  }
}
