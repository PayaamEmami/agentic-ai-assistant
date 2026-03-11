import type { DocumentInput } from './types.js';

export interface IndexingService {
  indexDocument(document: DocumentInput): Promise<void>;
  removeDocument(documentId: string): Promise<void>;
}

export class IndexingServiceImpl implements IndexingService {
  async indexDocument(_document: DocumentInput): Promise<void> {
    // TODO: orchestrate chunking -> embedding -> storage
  }

  async removeDocument(_documentId: string): Promise<void> {
    // TODO: remove chunks and embeddings for document
  }
}
