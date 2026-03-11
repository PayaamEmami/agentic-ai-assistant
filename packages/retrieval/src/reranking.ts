import type { SearchResult } from './types.js';

export interface RerankingService {
  rerank(query: string, results: SearchResult[]): Promise<SearchResult[]>;
}

export class PassthroughReranker implements RerankingService {
  async rerank(_query: string, results: SearchResult[]): Promise<SearchResult[]> {
    return results;
  }
}
