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

    logger.info({ signal }, 'Shutting down API server');

    try {
      await server.close();
      await closeConnectorSyncQueue();
      await closeToolExecutionQueue();
      await closeConfiguredToolRegistry();
      await stopToolEventRelay();
      await closePool();
      logger.info('Shutdown complete');
    } catch (err) {
      logger.error(err, 'Shutdown failed');
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
    logger.info(`Server listening on ${config.host}:${config.port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    await closeToolExecutionQueue();
    await closeConnectorSyncQueue();
    await closeConfiguredToolRegistry();
    await stopToolEventRelay();
    await closePool();
    process.exit(1);
  }
}

main();
