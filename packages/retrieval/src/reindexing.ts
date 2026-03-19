import type { ChunkingService } from './chunking.js';
import type { EmbeddingService } from './embedding.js';
import { IndexingServiceImpl } from './indexing.js';
import type { DocumentInput } from './types.js';

export interface DocumentReindexingService {
  reindexDocument(document: DocumentInput): Promise<void>;
}

export type ClearDocumentIndex = (documentId: string) => Promise<void>;
export type PersistChunk = (chunk: {
  id: string;
  documentId: string;
  content: string;
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}) => Promise<void>;
export type PersistEmbedding = (embedding: {
  chunkId: string;
  vector: number[];
  model: string;
}) => Promise<void>;

export class DocumentReindexingServiceImpl implements DocumentReindexingService {
  constructor(
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly clearDocumentIndex: ClearDocumentIndex,
    private readonly persistChunk: PersistChunk,
    private readonly persistEmbedding: PersistEmbedding,
  ) {}

  async reindexDocument(document: DocumentInput): Promise<void> {
    await this.clearDocumentIndex(document.id);

    const indexer = new IndexingServiceImpl(
      this.chunkingService,
      this.embeddingService,
      async (chunks) => {
        await Promise.all(chunks.map((chunk) => this.persistChunk(chunk)));
      },
      async (embeddings) => {
        await Promise.all(embeddings.map((embedding) => this.persistEmbedding(embedding)));
      },
      async () => {
        // Reindexing already cleared the current document.
      },
    );

    await indexer.indexDocument(document);
  }
}
