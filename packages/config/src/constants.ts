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
  chatContinuation: 'chat-continuation',
} as const;

export const QUEUE_JOB_OPTIONS = {
  [QUEUE_NAMES.appSync]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  [QUEUE_NAMES.ingestion]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  [QUEUE_NAMES.embedding]: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  [QUEUE_NAMES.toolExecution]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  [QUEUE_NAMES.chatContinuation]: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
} as const;

export const REDIS_PREFIXES = {
  session: 'session:',
  rateLimit: 'rate-limit:',
  cache: 'cache:',
} as const;
