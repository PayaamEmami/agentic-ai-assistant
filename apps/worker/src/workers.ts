import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, parseRedisUrl, type WorkerConfig } from '@aaa/config';
import { withLogContext, withSpan } from '@aaa/observability';
import type {
  AppSyncJobData,
  EmbeddingJobData,
  IngestionJobData,
  ToolExecutionJobData,
} from '@aaa/shared';
import { handleIngestion } from './jobs/ingestion.js';
import { handleEmbedding } from './jobs/embedding.js';
import { handleAppSync } from './jobs/app-sync.js';
import { handleToolExecution } from './jobs/tool-execution.js';
import { logger } from './lib/logger.js';
import { workerJobCounter, workerJobDurationMs } from './lib/telemetry.js';

function toConnectionOptions(config: WorkerConfig): ConnectionOptions {
  return parseRedisUrl(config.redisUrl);
}

export function createWorkers(config: WorkerConfig): Worker[] {
  const connection = toConnectionOptions(config);

  const workers = [
    new Worker<IngestionJobData>(
      QUEUE_NAMES.ingestion,
      (job) =>
        withLogContext(
          {
            queue: job.queueName,
            jobId: job.id ?? undefined,
            correlationId: job.data.correlationId,
            component: 'ingestion-worker',
          },
          () =>
            withSpan(
              'worker.job.ingestion',
              {
                'aaa.queue.name': job.queueName,
                'aaa.job.id': job.id ?? 'unknown',
              },
              () => handleIngestion(job),
            ),
        ),
      { connection },
    ),
    new Worker<EmbeddingJobData>(
      QUEUE_NAMES.embedding,
      (job) =>
        withLogContext(
          {
            queue: job.queueName,
            jobId: job.id ?? undefined,
            correlationId: job.data.correlationId,
            component: 'embedding-worker',
          },
          () =>
            withSpan(
              'worker.job.embedding',
              {
                'aaa.queue.name': job.queueName,
                'aaa.job.id': job.id ?? 'unknown',
              },
              () => handleEmbedding(job),
            ),
        ),
      { connection },
    ),
    new Worker<AppSyncJobData>(
      QUEUE_NAMES.appSync,
      (job) =>
        withLogContext(
          {
            queue: job.queueName,
            jobId: job.id ?? undefined,
            correlationId: job.data.correlationId,
            appKind: job.data.appKind,
            appCapability: job.data.capability,
            component: 'app-sync-worker',
          },
          () =>
            withSpan(
              'worker.job.app_sync',
              {
                'aaa.queue.name': job.queueName,
                'aaa.job.id': job.id ?? 'unknown',
              },
              () => handleAppSync(job),
            ),
        ),
      { connection },
    ),
    new Worker<ToolExecutionJobData>(
      QUEUE_NAMES.toolExecution,
      (job) =>
        withLogContext(
          {
            queue: job.queueName,
            jobId: job.id ?? undefined,
            correlationId: job.data.correlationId,
            conversationId: job.data.conversationId,
            toolExecutionId: job.data.toolExecutionId,
            component: 'tool-execution-worker',
          },
          () =>
            withSpan(
              'worker.job.tool_execution',
              {
                'aaa.queue.name': job.queueName,
                'aaa.job.id': job.id ?? 'unknown',
              },
              () => handleToolExecution(job),
            ),
        ),
      { connection },
    ),
  ];

  for (const worker of workers) {
    worker.on('completed', (job) => {
      const durationMs =
        typeof job.finishedOn === 'number' && typeof job.processedOn === 'number'
          ? job.finishedOn - job.processedOn
          : undefined;
      workerJobCounter.inc({ queue: job.queueName, outcome: 'success' });
      if (typeof durationMs === 'number' && durationMs >= 0) {
        workerJobDurationMs.observe({ queue: job.queueName, outcome: 'success' }, durationMs);
      }
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
      const durationMs =
        typeof job?.finishedOn === 'number' && typeof job?.processedOn === 'number'
          ? job.finishedOn - job.processedOn
          : undefined;
      workerJobCounter.inc({ queue: job?.queueName ?? 'unknown', outcome: 'failure' });
      if (typeof durationMs === 'number' && durationMs >= 0) {
        workerJobDurationMs.observe(
          { queue: job?.queueName ?? 'unknown', outcome: 'failure' },
          durationMs,
        );
      }
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
