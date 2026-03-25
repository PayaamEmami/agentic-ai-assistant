import { closePool, getPool } from '@aaa/db';
import { closeConfiguredToolRegistry } from '@aaa/mcp';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './lib/logger.js';
import { stopToolEventRelay, startToolEventRelay } from './services/tool-event-relay.js';
import { closeToolExecutionQueue } from './services/tool-execution-queue.js';
import { closeConnectorSyncQueue } from './services/connector-queue.js';

async function main() {
  const config = loadConfig();
  getPool();
  await startToolEventRelay();
  const server = await buildServer(config);
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
      await closeConnectorSyncQueue();
      await closeToolExecutionQueue();
      await closeConfiguredToolRegistry();
      await stopToolEventRelay();
      await closePool();
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
    await closeConnectorSyncQueue();
    await closeConfiguredToolRegistry();
    await stopToolEventRelay();
    await closePool();
    process.exit(1);
  }
}

main();
