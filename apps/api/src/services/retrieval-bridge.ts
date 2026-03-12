import { OpenAIProvider } from '@aaa/ai';
import {
  chunkRepository,
  documentRepository,
  embeddingRepository,
  sourceRepository,
} from '@aaa/db';
import { logger } from '../lib/logger.js';

const DEFAULT_RESULT_LIMIT = 6;
const MAX_RESULT_LIMIT = 20;
const CANDIDATE_MULTIPLIER = 4;

export interface RetrievalSearchResult {
  chunkId: string;
  documentId: string;
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  documentTitle: string;
  uri: string | null;
}

export interface RetrievalCitation {
  sourceId: string;
  chunkId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
  uri: string | null;
}

export interface RetrievalResponse {
  results: RetrievalSearchResult[];
  citations: RetrievalCitation[];
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_RESULT_LIMIT;
  }
  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(limit)));
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3);

  return Array.from(new Set(normalized));
}

function keywordBoost(query: string, content: string): number {
  const keywords = tokenize(query);
  if (keywords.length === 0) {
    return 0;
  }

  const normalizedContent = content.toLowerCase();
  let matches = 0;
  for (const keyword of keywords) {
    if (normalizedContent.includes(keyword)) {
      matches += 1;
    }
  }

  return (matches / keywords.length) * 0.25;
}

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

export class RetrievalBridge {
  private readonly modelProvider: OpenAIProvider | null;

  constructor(modelProvider?: OpenAIProvider) {
    const apiKey = process.env['OPENAI_API_KEY'];
    this.modelProvider =
      modelProvider ?? (apiKey ? new OpenAIProvider(apiKey, process.env['OPENAI_MODEL']) : null);
  }

  async search(query: string, userId: string, limit?: number): Promise<RetrievalResponse> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || !this.modelProvider) {
      return { results: [], citations: [] };
    }

    const normalizedLimit = normalizeLimit(limit);

    try {
      const embeddingResponse = await this.modelProvider.embed({
        input: [trimmedQuery],
        model: process.env['OPENAI_EMBEDDING_MODEL'],
      });
      const queryVector = embeddingResponse.embeddings[0];

      if (!queryVector || queryVector.length === 0) {
        return { results: [], citations: [] };
      }

      const candidateLimit = normalizedLimit * CANDIDATE_MULTIPLIER;
      const vectorMatches = await embeddingRepository.searchByVector(
        queryVector,
        candidateLimit,
        userId,
      );

      if (vectorMatches.length === 0) {
        return { results: [], citations: [] };
      }

      const hydratedResults = await Promise.all(
        vectorMatches.map(async (match, index) =>
          this.buildResultFromMatch(
            match.chunkId,
            index,
            vectorMatches.length,
            trimmedQuery,
            userId,
          ),
        ),
      );

      const results = hydratedResults
        .filter((result): result is RetrievalSearchResult => result !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, normalizedLimit);

      return {
        results,
        citations: this.assembleCitations(results),
      };
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          queryLength: trimmedQuery.length,
        },
        'Retrieval search failed',
      );
      return { results: [], citations: [] };
    }
  }

  private async buildResultFromMatch(
    chunkId: string,
    index: number,
    totalCandidates: number,
    query: string,
    userId: string,
  ): Promise<RetrievalSearchResult | null> {
    const chunk = await chunkRepository.findById(chunkId);
    if (!chunk) {
      return null;
    }

    const document = await documentRepository.findById(chunk.documentId);
    if (!document) {
      return null;
    }

    const source = document.sourceId ? await sourceRepository.findById(document.sourceId) : null;
    const belongsToUser =
      document.userId === userId || (document.userId === null && source?.userId === userId);
    if (!belongsToUser) {
      return null;
    }

    const sourceId = source?.id ?? document.sourceId ?? document.id;
    const baseScore = totalCandidates <= 1 ? 1 : 1 - index / (totalCandidates - 1);

    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      sourceId,
      content: chunk.content,
      score: baseScore + keywordBoost(query, chunk.content),
      metadata: chunk.metadata,
      documentTitle: document.title,
      uri: source?.uri ?? null,
    };
  }

  private assembleCitations(results: RetrievalSearchResult[]): RetrievalCitation[] {
    const topResultBySource = new Map<string, RetrievalSearchResult>();

    for (const result of results) {
      const current = topResultBySource.get(result.sourceId);
      if (!current || result.score > current.score) {
        topResultBySource.set(result.sourceId, result);
      }
    }

    const citations = Array.from(topResultBySource.values()).map((result) => ({
      sourceId: result.sourceId,
      chunkId: result.chunkId,
      documentTitle: result.documentTitle,
      excerpt: truncateOnWordBoundary(result.content, 300),
      score: result.score,
      uri: result.uri,
    }));

    citations.sort((a, b) => b.score - a.score);
    return citations;
  }
}
