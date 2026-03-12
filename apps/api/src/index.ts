import { closePool, getPool } from '@aaa/db';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './lib/logger.js';

async function main() {
  const config = loadConfig();
  getPool();
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
    await closePool();
    process.exit(1);
  }
}

main();
