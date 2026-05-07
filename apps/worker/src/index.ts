import { withLogContext } from '@aaa/observability';
import { closePool } from '@aaa/db';
import { loadWorkerConfig } from '@aaa/config';
import { createWorkers } from './workers.js';
import { logger } from './lib/logger.js';
import {
  closeChatContinuationQueue,
  initializeChatContinuationQueue,
} from './lib/chat-continuation-queue.js';
import { closeJobQueues, initializeJobQueues } from './lib/job-queues.js';
import { startAppSyncScheduler } from './lib/sync-scheduler.js';
import { initializeWorkerTelemetry, startWorkerObservabilityServer } from './lib/telemetry.js';
import { shutdownTracing } from '@aaa/observability';

async function main() {
  const config = loadWorkerConfig();
  const redisUrl = config.redisUrl;
  await initializeWorkerTelemetry();
  const observability = await startWorkerObservabilityServer(config);
  const redisTarget = new URL(redisUrl);
  logger.info(
    {
      event: 'worker.starting',
      outcome: 'start',
      redisHost: redisTarget.hostname,
      redisPort: redisTarget.port || '6379',
      component: 'worker-main',
    },
    'Starting worker service',
  );

  initializeJobQueues(config);
  initializeChatContinuationQueue(config);
  const workers = createWorkers(config);
  const syncScheduler = startAppSyncScheduler(config);
  logger.info(
    {
      event: 'worker.started',
      outcome: 'success',
      component: 'worker-main',
      workerCount: workers.length,
    },
    'Worker service started',
  );

  const shutdown = async () => {
    logger.info(
      {
        event: 'worker.stopping',
        outcome: 'stop',
        component: 'worker-main',
      },
      'Shutting down workers',
    );
    clearInterval(syncScheduler);
    observability.stopPolling();
    await new Promise<void>((resolve, reject) => {
      observability.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await Promise.all(workers.map((w) => w.close()));
    await closeChatContinuationQueue();
    await closeJobQueues();
    await closePool();
    await shutdownTracing();
    logger.info(
      {
        event: 'worker.stopped',
        outcome: 'success',
        component: 'worker-main',
      },
      'All workers stopped',
    );
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  withLogContext({ component: 'worker-main' }, () => {
    logger.error(
      {
        event: 'worker.startup_failed',
        outcome: 'failure',
        error: err,
      },
      'Worker startup failed',
    );
  });
  process.exit(1);
});
