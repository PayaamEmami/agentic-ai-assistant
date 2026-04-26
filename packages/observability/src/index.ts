export { createServiceLogger } from './logger.js';
export {
  addLogContext,
  getLogContext,
  getLogger,
  setDefaultLogger,
  withLogContext,
} from './context.js';
export { sanitizeForLogs, serializeError } from './sanitize.js';
export {
  createCounter,
  createGauge,
  createHistogram,
  getMetricsContentType,
  getMetricsRegistry,
  initializeMetrics,
  renderMetrics,
  outboundRequestCounter,
  outboundRequestDurationMs,
  openAiDurationMs,
  openAiEstimatedCostUsd,
  openAiRequestCounter,
  openAiTokens,
  databaseQueryCounter,
  databaseQueryDurationMs,
} from './metrics.js';
export { fetchWithTelemetry } from './http.js';
export { estimateOpenAiCost } from './pricing.js';
export {
  getActiveTraceMetadata,
  getTracer,
  initializeTracing,
  shutdownTracing,
  withSpan,
} from './tracing.js';
export { context as otelContext, trace, SpanStatusCode } from '@opentelemetry/api';
export type { Attributes, Span } from '@opentelemetry/api';
export type {
  LogContext,
  SerializedError,
  ServiceLoggerOptions,
  ServiceRuntimeOptions,
  TraceMetadata,
} from './types.js';
