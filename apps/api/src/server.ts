import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import {
  getLogger,
  getTracer,
  otelContext,
  SpanStatusCode,
  trace,
  type Span,
  withLogContext,
} from '@aaa/observability';
import type { AppConfig } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/errors.js';
import {
  httpInFlight,
  httpRequestDurationMs,
  httpRequestsTotal,
} from './lib/telemetry.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { uploadRoutes } from './routes/upload.js';
import { approvalRoutes } from './routes/approvals.js';
import { personalizationRoutes } from './routes/personalization.js';
import { voiceRoutes } from './routes/voice.js';
import { connectorRoutes } from './routes/connectors.js';
import { mcpRoutes } from './routes/mcp.js';
import { clientLogRoutes } from './routes/client-logs.js';
import { clientTelemetryRoutes } from './routes/client-telemetry.js';
import { wsHandler } from './ws/handler.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId?: string;
    observabilitySpan?: Span;
  }
}

export async function buildServer(config: AppConfig) {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId(request) {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && header.trim().length > 0
        ? header.trim()
        : crypto.randomUUID();
    },
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.decorate('config', config);

  app.addHook('onRequest', (request, reply, done) => {
    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId =
      typeof correlationHeader === 'string' && correlationHeader.trim().length > 0
        ? correlationHeader.trim()
        : request.id;
    const tracer = getTracer('api-http');
    const span = tracer.startSpan(`http ${request.method.toUpperCase()}`, {
      attributes: {
        'http.method': request.method,
        'http.route': request.url,
        'http.request_id': request.id,
        'aaa.correlation_id': correlationId,
      },
    });
    request.observabilitySpan = span;
    request.correlationId = correlationId;

    reply.header('x-request-id', request.id);
    reply.header('x-correlation-id', correlationId);
    httpInFlight.inc({ method: request.method });

    otelContext.with(trace.setSpan(otelContext.active(), span), () => {
      withLogContext(
        {
          requestId: request.id,
          correlationId,
          method: request.method,
          component: 'http',
        },
        () => {
          done();
        },
      );
    });
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? request.url;
    const outcome = reply.statusCode >= 500 ? 'failure' : 'success';
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
    getLogger({
      component: 'http',
      route,
      method: request.method,
    }).info(
      {
        event: 'http.request.completed',
        outcome,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'HTTP request completed',
    );
    httpInFlight.dec({ method: request.method });
    httpRequestsTotal.inc({
      method: request.method,
      route,
      outcome,
      status_class: statusClass,
    });
    httpRequestDurationMs.observe(
      {
        method: request.method,
        route,
        outcome,
      },
      reply.elapsedTime,
    );
    request.observabilitySpan?.setAttributes({
      'http.route': route,
      'http.status_code': reply.statusCode,
      'aaa.correlation_id': request.correlationId ?? request.id,
    });
    request.observabilitySpan?.setStatus({
      code: reply.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    request.observabilitySpan?.end();
    done();
  });

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(uploadRoutes, { prefix: '/api' });
  await app.register(approvalRoutes, { prefix: '/api' });
  await app.register(personalizationRoutes, { prefix: '/api' });
  await app.register(voiceRoutes, { prefix: '/api' });
  await app.register(connectorRoutes, { prefix: '/api' });
  await app.register(mcpRoutes, { prefix: '/api' });
  await app.register(clientLogRoutes, { prefix: '/api' });
  await app.register(clientTelemetryRoutes, { prefix: '/api' });
  await app.register(wsHandler, { prefix: '/ws' });

  return app;
}
