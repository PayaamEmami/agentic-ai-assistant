import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { withLogContext } from '@aaa/observability';
import { handleIngestion } from './jobs/ingestion.js';
import { handleEmbedding } from './jobs/embedding.js';
import { handleConnectorSync } from './jobs/connector-sync.js';
import { handleToolExecution } from './jobs/tool-execution.js';
import { logger } from './lib/logger.js';

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

export function createWorkers(redisUrl: string): Worker[] {
  const connection = parseRedisUrl(redisUrl);

  const workers = [
    new Worker('ingestion', (job) =>
      withLogContext(
        {
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
          component: 'ingestion-worker',
        },
        () => handleIngestion(job),
      ), { connection }),
    new Worker('embedding', (job) =>
      withLogContext(
        {
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
          component: 'embedding-worker',
        },
        () => handleEmbedding(job),
      ), { connection }),
    new Worker('connector-sync', (job) =>
      withLogContext(
        {
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
          connectorKind: job.data.connectorKind,
          component: 'connector-sync-worker',
        },
        () => handleConnectorSync(job),
      ), { connection }),
    new Worker('tool-execution', (job) =>
      withLogContext(
        {
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
          conversationId: job.data.conversationId,
          toolExecutionId: job.data.toolExecutionId,
          component: 'tool-execution-worker',
        },
        () => handleToolExecution(job),
      ), { connection }),
  ];

  for (const worker of workers) {
    worker.on('completed', (job) => {
      logger.info(
        {
          event: 'worker.job.completed',
          outcome: 'success',
          jobId: job.id,
          queue: job.queueName,
          correlationId: job.data.correlationId,
        },
        'Job completed',
      );
    });
    worker.on('failed', (job, err) => {
      logger.error(
        {
          event: 'worker.job.failed',
          outcome: 'failure',
          jobId: job?.id,
          queue: job?.queueName,
          correlationId: job?.data?.correlationId,
          error: err,
        },
        'Job failed',
      );
    });
  }

  return workers;
}
