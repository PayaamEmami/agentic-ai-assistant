import type { Logger } from 'pino';

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  conversationId?: string;
  connectorKind?: string;
  connectorConfigId?: string;
  documentId?: string;
  sourceId?: string;
  externalId?: string;
  toolExecutionId?: string;
  approvalId?: string;
  jobId?: string;
  queue?: string;
  provider?: string;
  component?: string;
  route?: string;
  method?: string;
  voiceSessionId?: string;
  mcpServerId?: string;
}

export interface ServiceLoggerOptions {
  service: string;
  level?: string;
  format?: 'pretty' | 'json';
  logDirectory?: string;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError;
}

export interface LogStore {
  context: LogContext;
  logger: Logger;
  baseLogger: Logger;
}
