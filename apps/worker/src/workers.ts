import { Worker } from 'bullmq';
import type { ConnectionOptions, Job, WorkerOptions } from 'bullmq';
import { QUEUE_NAMES, parseRedisUrl, type WorkerConfig } from '@aaa/config';
import { withLogContext, withSpan } from '@aaa/observability';
import type {
  AppSyncJobData,
  AutomationJobData,
  EmbeddingJobData,
  IngestionJobData,
  ToolExecutionJobData,
} from '@aaa/shared';
import { handleIngestion } from './jobs/ingestion.js';
import { handleEmbedding } from './jobs/embedding.js';
import { handleAppSync } from './jobs/app-sync.js';
import { abandonAutomationRun, handleAutomation } from './jobs/automation/index.js';
import { handleToolExecution } from './jobs/tool-execution/index.js';
import { logger } from './lib/logger.js';
import { workerJobCounter, workerJobDurationMs } from './lib/telemetry.js';

/** Coding jobs clone, plan, and open a PR; keep the lock well above a typical run. */
const LONG_RUNNING_LOCK_MS = 30 * 60 * 1000;

function toConnectionOptions(config: WorkerConfig): ConnectionOptions {
  return parseRedisUrl(config.redisUrl);
}

interface TrackedWorkerDefinition<TJobData extends { correlationId: string }> {
  queueName: string;
  component: string;
  spanName: string;
  handler: (job: Job<TJobData>) => Promise<void>;
  context?: (job: Job<TJobData>) => Record<string, unknown>;
  workerOptions?: Omit<WorkerOptions, 'connection'>;
}

function createTrackedWorker<TJobData extends { correlationId: string }>(
  connection: ConnectionOptions,
  definition: TrackedWorkerDefinition<TJobData>,
): Worker<TJobData> {
  return new Worker<TJobData>(
    definition.queueName,
    (job) =>
      withLogContext(
        {
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
          component: definition.component,
          ...definition.context?.(job),
        },
        () =>
          withSpan(
            definition.spanName,
            {
              'aaa.queue.name': job.queueName,
              'aaa.job.id': job.id ?? 'unknown',
            },
            () => definition.handler(job),
          ),
      ),
    { connection, ...definition.workerOptions },
  );
}

function getJobCorrelationId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('correlationId' in data)) {
    return undefined;
  }

  const correlationId = data.correlationId;
  return typeof correlationId === 'string' ? correlationId : undefined;
}

function trackWorkerEvents(worker: Worker): void {
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
        correlationId: getJobCorrelationId(job.data),
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
        correlationId: getJobCorrelationId(job?.data),
        error: err,
      },
      'Job failed',
    );

    if (job?.queueName === QUEUE_NAMES.automation) {
      const runId =
        typeof job.data === 'object' && job.data !== null && 'runId' in job.data
          ? job.data.runId
          : undefined;
      if (typeof runId === 'string') {
        void abandonAutomationRun(runId, err.message).catch((abandonError) => {
          logger.error(
            {
              event: 'automation.run.abandon_failed',
              outcome: 'failure',
              automationRunId: runId,
              error: abandonError,
            },
            'Failed to mark an abandoned automation run as failed',
          );
        });
      }
    }
  });
}

export function createWorkers(config: WorkerConfig): Worker[] {
  const connection = toConnectionOptions(config);

  const workers = [
    createTrackedWorker<IngestionJobData>(connection, {
      queueName: QUEUE_NAMES.ingestion,
      component: 'ingestion-worker',
      spanName: 'worker.job.ingestion',
      handler: handleIngestion,
    }),
    createTrackedWorker<EmbeddingJobData>(connection, {
      queueName: QUEUE_NAMES.embedding,
      component: 'embedding-worker',
      spanName: 'worker.job.embedding',
      handler: handleEmbedding,
    }),
    createTrackedWorker<AppSyncJobData>(connection, {
      queueName: QUEUE_NAMES.appSync,
      component: 'app-sync-worker',
      spanName: 'worker.job.app_sync',
      handler: handleAppSync,
      context: (job) => ({
        appKind: job.data.appKind,
        appCapability: job.data.capability,
      }),
    }),
    createTrackedWorker<ToolExecutionJobData>(connection, {
      queueName: QUEUE_NAMES.toolExecution,
      component: 'tool-execution-worker',
      spanName: 'worker.job.tool_execution',
      handler: handleToolExecution,
      workerOptions: { lockDuration: LONG_RUNNING_LOCK_MS },
      context: (job) => ({
        conversationId: job.data.conversationId,
        toolExecutionId: job.data.toolExecutionId,
      }),
    }),
    createTrackedWorker<AutomationJobData>(connection, {
      queueName: QUEUE_NAMES.automation,
      component: 'automation-worker',
      spanName: 'worker.job.automation',
      handler: handleAutomation,
      workerOptions: { lockDuration: LONG_RUNNING_LOCK_MS },
      context: (job) => ({
        automationRunId: job.data.runId,
        scheduleId: job.data.scheduleId,
      }),
    }),
  ];

  for (const worker of workers) {
    trackWorkerEvents(worker);
  }

  return workers;
}
