import type { Logger } from 'pino';

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  conversationId?: string;
  appKind?: string;
  appCapability?: string;
  appCapabilityConfigId?: string;
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
  wsConnectionId?: string;
  clientSessionId?: string;
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
  statusCode?: number;
  cause?: SerializedError;
  details?: Record<string, unknown>;
}

export interface LogStore {
  context: LogContext;
  logger: Logger;
  baseLogger: Logger;
}

export interface TraceMetadata {
  traceId?: string;
  spanId?: string;
}

export interface ServiceRuntimeOptions {
  service: string;
  serviceVersion?: string;
  environment?: string;
  namespace?: string;
  instanceId?: string;
  otlpEndpoint?: string;
  resourceAttributes?: Record<string, string>;
}
