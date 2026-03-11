import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import type { AppConfig } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { uploadRoutes } from './routes/upload.js';
import { approvalRoutes } from './routes/approvals.js';
import { voiceRoutes } from './routes/voice.js';
import { wsHandler } from './ws/handler.js';

export async function buildServer(config: AppConfig) {
  const app = Fastify({
    logger: logger,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(uploadRoutes, { prefix: '/api' });
  await app.register(approvalRoutes, { prefix: '/api' });
  await app.register(voiceRoutes, { prefix: '/api' });
  await app.register(wsHandler, { prefix: '/ws' });

  app.decorate('config', config);

  return app;
}
