import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { getLogger, withLogContext } from '@aaa/observability';
import type { AppConfig } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { uploadRoutes } from './routes/upload.js';
import { approvalRoutes } from './routes/approvals.js';
import { personalizationRoutes } from './routes/personalization.js';
import { voiceRoutes } from './routes/voice.js';
import { connectorRoutes } from './routes/connectors.js';
import { clientLogRoutes } from './routes/client-logs.js';
import { wsHandler } from './ws/handler.js';

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

  app.addHook('onRequest', (request, reply, done) => {
    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId =
      typeof correlationHeader === 'string' && correlationHeader.trim().length > 0
        ? correlationHeader.trim()
        : request.id;

    reply.header('x-request-id', request.id);
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

  app.addHook('onResponse', (request, reply, done) => {
    getLogger({
      component: 'http',
      route: request.routeOptions.url,
      method: request.method,
    }).info(
      {
        event: 'http.request.completed',
        outcome: reply.statusCode >= 500 ? 'failure' : 'success',
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'HTTP request completed',
    );
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
  await app.register(clientLogRoutes, { prefix: '/api' });
  await app.register(wsHandler, { prefix: '/ws' });

  app.decorate('config', config);

  return app;
}
