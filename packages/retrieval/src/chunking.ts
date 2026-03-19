import { randomUUID } from 'node:crypto';
import type { DocumentInput, ChunkResult } from './types.js';

export interface ChunkingService {
  chunk(document: DocumentInput, chunkSize?: number, overlap?: number): Promise<ChunkResult[]>;
}

const TOKEN_MULTIPLIER = 1.3;

function tokenizeWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function estimateTokenCount(text: string): number {
  const wordCount = tokenizeWords(text).length;
  return wordCount === 0 ? 0 : Math.ceil(wordCount * TOKEN_MULTIPLIER);
}

function buildChunkWithOverlap(
  previousChunk: string,
  nextParagraph: string,
  overlapTokens: number,
  chunkSize: number,
): string {
  if (overlapTokens <= 0) {
    return nextParagraph;
  }

  const previousWords = tokenizeWords(previousChunk);
  if (previousWords.length === 0) {
    return nextParagraph;
  }

  let wordsToTake = Math.min(previousWords.length, Math.ceil(overlapTokens / TOKEN_MULTIPLIER));

  while (wordsToTake > 0) {
    const overlapText = previousWords.slice(-wordsToTake).join(' ');
    const candidate = `${overlapText}\n\n${nextParagraph}`;
    if (estimateTokenCount(candidate) <= chunkSize) {
      return candidate;
    }
    wordsToTake -= 1;
  }

  return nextParagraph;
}

export class SimpleChunkingService implements ChunkingService {
  async chunk(document: DocumentInput, chunkSize = 512, overlap = 64): Promise<ChunkResult[]> {
    const content = document.content.trim();
    if (content.length === 0) {
      return [];
    }

    const maxChunkSize = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 512;
    const overlapTokens = Number.isFinite(overlap) && overlap > 0 ? Math.floor(overlap) : 0;

    const paragraphs = content
      .split(/\r?\n\r?\n+/)
      .map(paragraph => paragraph.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return [];
    }

    const chunkContents: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if (currentChunk.length === 0) {
        currentChunk = paragraph;
        continue;
      }

      const candidateChunk = `${currentChunk}\n\n${paragraph}`;
      if (estimateTokenCount(candidateChunk) <= maxChunkSize) {
        currentChunk = candidateChunk;
        continue;
      }

      chunkContents.push(currentChunk);
      currentChunk = buildChunkWithOverlap(currentChunk, paragraph, overlapTokens, maxChunkSize);
    }

    if (currentChunk.length > 0) {
      chunkContents.push(currentChunk);
    }

    return chunkContents.map((chunkContent, index) => ({
      id: randomUUID(),
      documentId: document.id,
      content: chunkContent,
      index,
      tokenCount: estimateTokenCount(chunkContent),
      metadata: { ...document.metadata },
    }));
  }
}
