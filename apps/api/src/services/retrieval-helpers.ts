import type { RetrievalCitation, RetrievalResponse } from './retrieval-bridge.js';

export const MAX_CITATIONS = 6;

export function appLabel(kind: string): string {
  switch (kind) {
    case 'github':
      return 'GitHub';
    case 'google':
      return 'Google';
    default:
      return kind;
  }
}

export function buildRetrievalContextSections(retrieval: RetrievalResponse): string[] {
  return retrieval.results.map((result) => {
    const appKind =
      typeof result.metadata['appKind'] === 'string' ? result.metadata['appKind'] : null;
    const lines = [
      `Title: ${result.documentTitle}`,
      appKind ? `App: ${appLabel(appKind)}` : null,
      result.uri ? `URI: ${result.uri}` : null,
      `Content:\n${result.content}`,
    ].filter((line): line is string => line !== null);

    return lines.join('\n');
  });
}

export function toCitationContentBlocks(
  citations: RetrievalCitation[],
): Array<Record<string, unknown>> {
  return citations.slice(0, MAX_CITATIONS).map((citation) => ({
    type: 'citation',
    sourceId: citation.sourceId,
    title: citation.documentTitle,
    excerpt: citation.excerpt,
    uri: citation.uri,
    score: citation.score,
  }));
}

export function truncateCitationExcerpt(content: string, maxLength = 300): string {
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

export function extractExplicitCitationIndexes(text: string): number[] {
  const matches = text.matchAll(/\[Sources?\s+([^\]]+)\]/gi);
  const indexes = new Set<number>();

  for (const match of matches) {
    const body = match[1];
    if (!body) {
      continue;
    }

    const numberMatches = body.matchAll(/\d+/g);
    for (const numberMatch of numberMatches) {
      const rawValue = numberMatch[0];
      if (!rawValue) {
        continue;
      }

      const parsed = Number.parseInt(rawValue, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        indexes.add(parsed);
      }
    }
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

export function selectDisplayedCitations(
  assistantResponse: string,
  retrieval: RetrievalResponse,
): RetrievalCitation[] {
  const citedIndexes = extractExplicitCitationIndexes(assistantResponse);
  if (citedIndexes.length === 0) {
    return [];
  }

  const citationsBySource = new Map<string, RetrievalCitation>();

  for (const citedIndex of citedIndexes) {
    const result = retrieval.results[citedIndex - 1];
    if (!result) {
      continue;
    }

    const citation: RetrievalCitation = {
      sourceId: result.sourceId,
      chunkId: result.chunkId,
      documentTitle: result.documentTitle,
      excerpt: truncateCitationExcerpt(result.content),
      score: result.score,
      uri: result.uri,
    };

    const current = citationsBySource.get(citation.sourceId);
    if (!current || citation.score > current.score) {
      citationsBySource.set(citation.sourceId, citation);
    }
  }

  return Array.from(citationsBySource.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CITATIONS);
}
