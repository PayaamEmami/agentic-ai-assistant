import type { SearchResult } from './types.js';

export interface RerankingService {
  rerank(query: string, results: SearchResult[]): Promise<SearchResult[]>;
}

export class PassthroughReranker implements RerankingService {
  async rerank(_query: string, results: SearchResult[]): Promise<SearchResult[]> {
    return results;
  }
}

function extractKeywords(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

export class KeywordReranker implements RerankingService {
  async rerank(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    const keywords = extractKeywords(query);
    if (keywords.length === 0 || results.length === 0) {
      return [...results];
    }

    const reranked = results.map((result) => {
      const content = result.content.toLowerCase();
      let keywordMatches = 0;

      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          keywordMatches += 1;
        }
      }

      const score = result.score * (1 + 0.1 * keywordMatches);
      return { ...result, score };
    });

    reranked.sort((a, b) => b.score - a.score);
    return reranked;
  }
}
