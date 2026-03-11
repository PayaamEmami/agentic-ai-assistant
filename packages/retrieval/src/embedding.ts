import type { EmbeddingResult } from './types.js';

export interface EmbeddingService {
  generateEmbeddings(chunks: Array<{ id: string; content: string }>): Promise<EmbeddingResult[]>;
}
