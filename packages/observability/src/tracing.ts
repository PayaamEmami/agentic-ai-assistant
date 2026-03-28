import { randomUUID } from 'node:crypto';
import { context, trace, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { ServiceRuntimeOptions, TraceMetadata } from './types.js';

let provider: NodeTracerProvider | null = null;
let providerStarted = false;
let serviceName = 'unknown';

function normalizeHeaders(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

function buildResource(options: ServiceRuntimeOptions) {
  return resourceFromAttributes({
    'service.name': options.service,
    'service.version': options.serviceVersion ?? process.env['npm_package_version'] ?? '0.0.1',
    'deployment.environment': options.environment ?? process.env['NODE_ENV'] ?? 'development',
    'service.namespace': options.namespace ?? process.env['OTEL_SERVICE_NAMESPACE'] ?? 'aaa',
    'service.instance.id': options.instanceId ?? randomUUID(),
    ...options.resourceAttributes,
  });
}

export async function initializeTracing(options: ServiceRuntimeOptions): Promise<void> {
  serviceName = options.service;
  if (providerStarted) {
    return;
  }

  provider = new NodeTracerProvider({
    resource: buildResource(options),
    spanProcessors:
      options.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
        ? [
            new BatchSpanProcessor(
              new OTLPTraceExporter({
                url: `${normalizeHeaders(
                  options.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '',
                )}/v1/traces`,
              }),
            ),
          ]
        : [],
  });

  provider.register({
    contextManager: new AsyncLocalStorageContextManager(),
  });
  providerStarted = true;
}

export async function shutdownTracing(): Promise<void> {
  if (!provider) {
    return;
  }

  const current = provider;
  provider = null;
  providerStarted = false;
  await current.shutdown();
}

export function getTracer(name?: string) {
  return trace.getTracer(name ?? serviceName);
}

export function getActiveTraceMetadata(): TraceMetadata {
  const activeSpan = trace.getSpan(context.active());
  const spanContext = activeSpan?.spanContext();
  if (!spanContext) {
    return {};
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
