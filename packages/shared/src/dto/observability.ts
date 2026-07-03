import { z } from 'zod';

export const ClientLogLevelDto = z.enum(['warn', 'error']);
export type ClientLogLevelDto = z.infer<typeof ClientLogLevelDto>;

export const ClientLogPayload = z.object({
  level: ClientLogLevelDto,
  event: z.string().min(1).max(120),
  component: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  requestId: z.string().max(120).optional(),
  correlationId: z.string().max(120).optional(),
  clientSessionId: z.string().max(120).optional(),
  conversationId: z.string().uuid().optional(),
  voiceSessionId: z.string().max(120).optional(),
  context: z.record(z.unknown()).default({}),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(1000).optional(),
  timestamp: z.string().datetime(),
});
export type ClientLogPayload = z.infer<typeof ClientLogPayload>;

export const ClientLogRequest = z.object({
  logs: z.array(ClientLogPayload).min(1).max(20),
});
export type ClientLogRequest = z.infer<typeof ClientLogRequest>;

export const ClientLogResponse = z.object({
  accepted: z.boolean(),
});
export type ClientLogResponse = z.infer<typeof ClientLogResponse>;

export const ClientTelemetryMetricNameDto = z.enum(['CLS', 'INP', 'LCP', 'FCP', 'TTFB']);
export type ClientTelemetryMetricNameDto = z.infer<typeof ClientTelemetryMetricNameDto>;

export const ClientTelemetryMetricPayload = z.object({
  name: ClientTelemetryMetricNameDto,
  value: z.number().finite().nonnegative(),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
  id: z.string().max(120).optional(),
  requestId: z.string().max(120).optional(),
  correlationId: z.string().max(120).optional(),
  clientSessionId: z.string().max(120).optional(),
  conversationId: z.string().uuid().optional(),
  voiceSessionId: z.string().max(120).optional(),
  route: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(1000).optional(),
  timestamp: z.string().datetime(),
});
export type ClientTelemetryMetricPayload = z.infer<typeof ClientTelemetryMetricPayload>;

export const ClientTelemetryRequest = z.object({
  metrics: z.array(ClientTelemetryMetricPayload).min(1).max(20),
});
export type ClientTelemetryRequest = z.infer<typeof ClientTelemetryRequest>;

export const ClientTelemetryResponse = z.object({
  accepted: z.boolean(),
});
export type ClientTelemetryResponse = z.infer<typeof ClientTelemetryResponse>;
