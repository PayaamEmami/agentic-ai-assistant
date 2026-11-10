export interface DocumentInput {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export interface ChunkResult {
  id: string;
  documentId: string;
  content: string;
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface EmbeddingResult {
  chunkId: string;
  vector: number[];
  model: string;
}
