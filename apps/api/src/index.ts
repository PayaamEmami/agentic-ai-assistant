import { closePool, getPool } from '@aaa/db';
import { shutdownTracing } from '@aaa/observability';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './lib/logger.js';
import { initializeApiTelemetry } from './lib/telemetry.js';
import { buildApiServices } from './services/container.js';
import {
  startChatContinuationWorker,
  stopChatContinuationWorker,
} from './services/chat-continuation-worker.js';
import { stopToolEventRelay, startToolEventRelay } from './services/tool-event-relay.js';
import { closeToolExecutionQueue } from './services/tool-execution-queue.js';
import { closeAppSyncQueue } from './services/app-queue.js';

async function main() {
  const config = loadConfig();
  const services = buildApiServices(config);
  await initializeApiTelemetry();
  getPool();
  await startToolEventRelay();
  const server = await buildServer(config, services);
  startChatContinuationWorker(config, services.chatService);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(
      {
        event: 'api.stopping',
        outcome: 'stop',
        signal,
        component: 'api-main',
      },
      'Shutting down API server',
    );

    try {
      await server.close();
      await stopChatContinuationWorker();
      await closeAppSyncQueue();
      await closeToolExecutionQueue();
      await stopToolEventRelay();
      await closePool();
      await shutdownTracing();
      logger.info(
        {
          event: 'api.stopped',
          outcome: 'success',
          component: 'api-main',
        },
        'Shutdown complete',
      );
    } catch (err) {
      logger.error(
        {
          event: 'api.stop_failed',
          outcome: 'failure',
          component: 'api-main',
          error: err,
        },
        'Shutdown failed',
      );
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await server.listen({ host: config.host, port: config.port });
    logger.info(
      {
        event: 'api.started',
        outcome: 'success',
        component: 'api-main',
        host: config.host,
        port: config.port,
      },
      'Server listening',
    );
  } catch (err) {
    logger.error(
      {
        event: 'api.start_failed',
        outcome: 'failure',
        component: 'api-main',
        error: err,
      },
      'Failed to start server',
    );
    await closeToolExecutionQueue();
    await closeAppSyncQueue();
    await stopChatContinuationWorker();
    await stopToolEventRelay();
    await closePool();
    await shutdownTracing();
    process.exit(1);
  }
}

main();
