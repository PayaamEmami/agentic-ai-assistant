import { randomUUID } from 'node:crypto';
import {
  createCounter,
  createGauge,
  createHistogram,
  initializeMetrics,
  initializeTracing,
} from '@aaa/observability';

const instanceId = process.env['HOSTNAME'] ?? randomUUID();

export async function initializeApiTelemetry(): Promise<void> {
  initializeMetrics('api', instanceId);
  await initializeTracing({
    service: 'api',
    instanceId,
  });
}

export const httpRequestsTotal = createCounter({
  name: 'aaa_api_http_requests_total',
  help: 'API HTTP requests grouped by method, route, outcome, and status class',
  labelNames: ['method', 'route', 'outcome', 'status_class'] as const,
}) as ReturnType<typeof createCounter>;

export const httpRequestDurationMs = createHistogram({
  name: 'aaa_api_http_request_duration_ms',
  help: 'API HTTP request duration in milliseconds grouped by method, route, and outcome',
  labelNames: ['method', 'route', 'outcome'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
}) as ReturnType<typeof createHistogram>;

export const httpInFlight = createGauge({
  name: 'aaa_api_http_in_flight',
  help: 'Current in-flight API HTTP requests',
  labelNames: ['method'] as const,
}) as ReturnType<typeof createGauge>;

export const readinessState = createGauge({
  name: 'aaa_api_readiness_state',
  help: 'API readiness state where 1 means ready',
  labelNames: ['dependency'] as const,
}) as ReturnType<typeof createGauge>;

export const websocketConnections = createGauge({
  name: 'aaa_api_websocket_connections',
  help: 'Active WebSocket connections',
  labelNames: ['state'] as const,
}) as ReturnType<typeof createGauge>;

export const websocketMessagesTotal = createCounter({
  name: 'aaa_api_websocket_messages_total',
  help: 'WebSocket message count grouped by direction and outcome',
  labelNames: ['direction', 'outcome'] as const,
}) as ReturnType<typeof createCounter>;

export const websocketSubscriptionsTotal = createCounter({
  name: 'aaa_api_websocket_subscriptions_total',
  help: 'WebSocket subscription attempts grouped by outcome',
  labelNames: ['outcome'] as const,
}) as ReturnType<typeof createCounter>;

export const clientWebVitals = createHistogram({
  name: 'aaa_api_client_web_vital_value',
  help: 'Observed browser Web Vital values grouped by metric name and rating',
  labelNames: ['metric_name', 'rating'] as const,
  buckets: [1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
}) as ReturnType<typeof createHistogram>;

export const clientTelemetryAccepted = createCounter({
  name: 'aaa_api_client_telemetry_total',
  help: 'Client telemetry events accepted by metric name',
  labelNames: ['metric_name'] as const,
}) as ReturnType<typeof createCounter>;
