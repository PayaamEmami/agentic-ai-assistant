import { randomUUID } from 'node:crypto';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
} from 'prom-client';

const registry = new Registry();
let initialized = false;
let serviceName = 'unknown';
let serviceInstanceId: string = randomUUID();

function metricDefaultLabels(): Record<string, string> {
  return {
    service: serviceName,
    service_instance_id: serviceInstanceId,
  };
}

export function initializeMetrics(service: string, instanceId?: string): void {
  serviceName = service;
  serviceInstanceId = instanceId ?? serviceInstanceId;
  registry.setDefaultLabels(metricDefaultLabels());

  if (initialized) {
    return;
  }

  collectDefaultMetrics({
    register: registry,
    prefix: 'aaa_',
  });
  initialized = true;
}

export function getMetricsRegistry(): Registry {
  return registry;
}

export function getMetricsContentType(): string {
  return registry.contentType;
}

export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export function createCounter<T extends string>(config: CounterConfiguration<T>): Counter<T> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) {
    return existing as Counter<T>;
  }

  return new Counter<T>({
    ...config,
    registers: [registry],
  });
}

export function createGauge<T extends string>(config: GaugeConfiguration<T>): Gauge<T> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) {
    return existing as Gauge<T>;
  }

  return new Gauge<T>({
    ...config,
    registers: [registry],
  });
}

export function createHistogram<T extends string>(config: HistogramConfiguration<T>): Histogram<T> {
  const existing = registry.getSingleMetric(config.name);
  if (existing) {
    return existing as Histogram<T>;
  }

  return new Histogram<T>({
    ...config,
    registers: [registry],
  });
}

export const outboundRequestCounter = createCounter({
  name: 'aaa_outbound_http_requests_total',
  help: 'Total outbound HTTP requests grouped by component, provider, method, and outcome',
  labelNames: ['component', 'provider', 'method', 'outcome', 'status_code'] as const,
});

export const outboundRequestDurationMs = createHistogram({
  name: 'aaa_outbound_http_request_duration_ms',
  help: 'Outbound HTTP request duration in milliseconds',
  labelNames: ['component', 'provider', 'method', 'outcome'] as const,
  buckets: [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const openAiRequestCounter = createCounter({
  name: 'aaa_openai_requests_total',
  help: 'Total OpenAI requests grouped by operation, model, and outcome',
  labelNames: ['operation', 'model', 'outcome'] as const,
});

export const openAiDurationMs = createHistogram({
  name: 'aaa_openai_request_duration_ms',
  help: 'OpenAI request duration in milliseconds',
  labelNames: ['operation', 'model', 'outcome'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const openAiTokens = createCounter({
  name: 'aaa_openai_tokens_total',
  help: 'OpenAI token usage grouped by operation, model, and token type',
  labelNames: ['operation', 'model', 'token_type'] as const,
});

export const openAiEstimatedCostUsd = createCounter({
  name: 'aaa_openai_estimated_cost_usd_total',
  help: 'Estimated OpenAI cost in USD grouped by operation and model',
  labelNames: ['operation', 'model'] as const,
});

export const databaseQueryCounter = createCounter({
  name: 'aaa_db_queries_total',
  help: 'Database query count grouped by operation and outcome',
  labelNames: ['operation', 'outcome'] as const,
});

export const databaseQueryDurationMs = createHistogram({
  name: 'aaa_db_query_duration_ms',
  help: 'Database query duration in milliseconds grouped by operation and outcome',
  labelNames: ['operation', 'outcome'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
});
