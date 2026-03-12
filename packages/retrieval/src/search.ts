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
    const text = query.text.trim();
    if (!text || !this.dependencies) {
      return [];
    }

    const limit = normalizeLimit(query.limit);
    const queryEmbedding = await this.dependencies.embedQuery(text);
    if (queryEmbedding.length === 0) {
      return [];
    }

    return this.dependencies.searchByVector(queryEmbedding, limit, query.filters);
  }
}
