import type { SearchQuery, SearchResult } from './types.js';

export interface SearchService {
  search(query: SearchQuery): Promise<SearchResult[]>;
}

export class VectorSearchService implements SearchService {
  async search(_query: SearchQuery): Promise<SearchResult[]> {
    // TODO: embed query, search pgvector, return results
    return [];
  }
}
