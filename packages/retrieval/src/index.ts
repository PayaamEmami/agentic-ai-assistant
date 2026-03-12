export type {
  DocumentInput,
  ChunkResult,
  EmbeddingResult,
  SearchQuery,
  SearchFilters,
  SearchResult,
  CitationRef,
} from './types.js';

export type { ChunkingService } from './chunking.js';
export { SimpleChunkingService } from './chunking.js';

export type { EmbeddingService } from './embedding.js';

export type { IndexingService, StoreChunks, StoreEmbeddings, RemoveByDocument } from './indexing.js';
export { IndexingServiceImpl } from './indexing.js';

export type { SearchService } from './search.js';
export { VectorSearchService } from './search.js';

export type { RerankingService } from './reranking.js';
export { PassthroughReranker, KeywordReranker } from './reranking.js';

export type { CitationService, DocumentMetadataResolver } from './citations.js';
export { CitationServiceImpl } from './citations.js';
