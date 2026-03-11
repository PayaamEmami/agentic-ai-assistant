import { createWorkers } from './workers.js';
import { logger } from './lib/logger.js';

async function main() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  logger.info({ redisUrl }, 'Starting worker service');

  const workers = createWorkers(redisUrl);
  logger.info(`Started ${workers.length} workers`);

  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all(workers.map(w => w.close()));
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
