import type { ChunkingService } from './chunking.js';
import type { EmbeddingService } from './embedding.js';
import type { ChunkResult, DocumentInput, EmbeddingResult } from './types.js';

export interface IndexingService {
  indexDocument(document: DocumentInput): Promise<void>;
  removeDocument(documentId: string): Promise<void>;
}

export type StoreChunks = (chunks: ChunkResult[]) => Promise<void>;
export type StoreEmbeddings = (embeddings: EmbeddingResult[]) => Promise<void>;
export type RemoveByDocument = (documentId: string) => Promise<void>;

export class IndexingServiceImpl implements IndexingService {
  constructor(
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly storeChunks: StoreChunks,
    private readonly storeEmbeddings: StoreEmbeddings,
    private readonly removeByDocument: RemoveByDocument,
  ) {}

  async indexDocument(document: DocumentInput): Promise<void> {
    const chunks = await this.chunkingService.chunk(document);
    const embeddings = chunks.length
      ? await this.embeddingService.generateEmbeddings(
          chunks.map((chunk) => ({ id: chunk.id, content: chunk.content })),
        )
      : [];

    await this.storeChunks(chunks);
    await this.storeEmbeddings(embeddings);
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.removeByDocument(documentId);
  }
}
