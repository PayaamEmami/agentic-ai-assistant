export const APP_NAME = 'Agentic AI Assistant';

export const DEFAULTS = {
  embeddingDimension: 1536,
  chunkSize: 512,
  chunkOverlap: 64,
  maxTokensPerRequest: 8192,
  maxFileUploadBytes: 10 * 1024 * 1024, // 10 MB
  conversationHistoryLimit: 50,
  searchResultLimit: 10,
} as const;

export const QUEUE_NAMES = {
  ingestion: 'ingestion',
  embedding: 'embedding',
  appSync: 'app-sync',
  toolExecution: 'tool-execution',
} as const;

export const REDIS_PREFIXES = {
  session: 'session:',
  rateLimit: 'rate-limit:',
  cache: 'cache:',
} as const;
