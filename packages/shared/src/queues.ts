export interface AppSyncJobData {
  appCapabilityConfigId: string;
  userId: string;
  appKind: 'github' | 'google';
  capability: 'knowledge';
  correlationId: string;
}

export interface IngestionJobData {
  appCapabilityConfigId: string;
  appKind: 'github' | 'google';
  documentId: string;
  sourceId: string;
  userId: string;
  externalId: string;
  correlationId: string;
}

export interface EmbeddingJobData {
  chunkIds: string[];
  model: string;
  correlationId: string;
}

export interface ToolExecutionJobData {
  toolExecutionId: string;
  toolName: string;
  input: Record<string, unknown>;
  conversationId: string;
  correlationId: string;
}

export interface ChatContinuationJobData {
  toolExecutionId: string;
  conversationId: string;
  correlationId: string;
}
