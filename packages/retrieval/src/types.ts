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

export interface SearchQuery {
  text: string;
  userId: string;
  limit?: number;
  filters?: SearchFilters;
}

export interface SearchFilters {
  sourceKinds?: string[];
  appKinds?: string[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface CitationRef {
  sourceId: string;
  chunkId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
  uri: string | null;
}
