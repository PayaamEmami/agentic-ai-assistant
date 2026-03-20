import { closePool } from '@aaa/db';
import { closeConfiguredToolRegistry } from '@aaa/mcp';
import { createWorkers } from './workers.js';
import { logger } from './lib/logger.js';
import { closeJobQueues } from './lib/job-queues.js';
import { startConnectorSyncScheduler } from './lib/sync-scheduler.js';

async function main() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  logger.info({ redisUrl }, 'Starting worker service');

  const workers = createWorkers(redisUrl);
  const syncScheduler = startConnectorSyncScheduler();
  logger.info(`Started ${workers.length} workers`);

  const shutdown = async () => {
    logger.info('Shutting down workers...');
    clearInterval(syncScheduler);
    await Promise.all(workers.map(w => w.close()));
    await closeJobQueues();
    await closeConfiguredToolRegistry();
    await closePool();
    logger.info('All workers stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Worker startup failed:', err);
  process.exit(1);
});
