import type { SearchResult, CitationRef } from './types.js';

export interface CitationService {
  assembleCitations(results: SearchResult[]): Promise<CitationRef[]>;
}

export interface DocumentMetadataResolver {
  resolve(documentId: string): Promise<{ title: string; uri: string | null }>;
}

const DEFAULT_METADATA_RESOLVER: DocumentMetadataResolver = {
  async resolve(): Promise<{ title: string; uri: string | null }> {
    return { title: '', uri: null };
  },
};

function truncateOnWordBoundary(content: string, maxLength: number): string {
  const normalized = content.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const slice = normalized.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace <= 0) {
    return slice.trimEnd();
  }

  return slice.slice(0, lastSpace).trimEnd();
}

export class CitationServiceImpl implements CitationService {
  constructor(private readonly metadataResolver: DocumentMetadataResolver = DEFAULT_METADATA_RESOLVER) {}

  async assembleCitations(results: SearchResult[]): Promise<CitationRef[]> {
    const topResultBySource = new Map<string, SearchResult>();

    for (const result of results) {
      const current = topResultBySource.get(result.sourceId);
      if (!current || result.score > current.score) {
        topResultBySource.set(result.sourceId, result);
      }
    }

    const citations = await Promise.all(
      Array.from(topResultBySource.values()).map(async result => {
        let metadata = { title: '', uri: null as string | null };
        try {
          metadata = await this.metadataResolver.resolve(result.documentId);
        } catch {
          metadata = { title: '', uri: null };
        }

        return {
          sourceId: result.sourceId,
          chunkId: result.chunkId,
          documentTitle: metadata.title,
          excerpt: truncateOnWordBoundary(result.content, 300),
          score: result.score,
          uri: metadata.uri,
        };
      }),
    );

    citations.sort((a, b) => b.score - a.score);
    return citations;
  }
}
