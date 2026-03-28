import { getLogger, withSpan } from '@aaa/observability';
import type { SearchFilters, SearchQuery, SearchResult } from './types.js';

export interface SearchService {
  search(query: SearchQuery): Promise<SearchResult[]>;
}

export interface VectorSearchDependencies {
  embedQuery: (queryText: string) => Promise<number[]>;
  searchByVector: (
    vector: number[],
    limit: number,
    filters?: SearchFilters,
  ) => Promise<SearchResult[]>;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 10;
  }

  return Math.max(1, Math.min(50, Math.floor(limit)));
}

export class VectorSearchService implements SearchService {
  constructor(private readonly dependencies?: VectorSearchDependencies) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const logger = getLogger({ component: 'vector-search' });
    const text = query.text.trim();
    if (!text || !this.dependencies) {
      return [];
    }

    const dependencies = this.dependencies;
    const limit = normalizeLimit(query.limit);
    const queryEmbedding = await dependencies.embedQuery(text);
    if (queryEmbedding.length === 0) {
      return [];
    }

    const results = await withSpan(
      'retrieval.vector_search',
      {
        'aaa.retrieval.limit': limit,
        'aaa.retrieval.query_length': text.length,
      },
      () => dependencies.searchByVector(queryEmbedding, limit, query.filters),
    );
    logger.debug(
      {
        event: 'retrieval.vector_search.completed',
        outcome: 'success',
        queryLength: text.length,
        limit,
        resultCount: results.length,
        hasFilters: Boolean(query.filters),
      },
      'Vector search completed',
    );
    return results;
  }
}
