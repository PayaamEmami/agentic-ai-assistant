import type { ConnectionOptions } from 'bullmq';
import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl, type WorkerConfig } from '@aaa/config';
import { createQueueProducer, type QueueProducer } from '@aaa/queues';
import type { AppSyncJobData, EmbeddingJobData, IngestionJobData } from '@aaa/shared';

interface JobQueueProducers {
  appSync: QueueProducer<AppSyncJobData>;
  ingestion: QueueProducer<IngestionJobData>;
  embedding: QueueProducer<EmbeddingJobData>;
}

let producers: JobQueueProducers | null = null;

function createJobQueueProducers(connection: ConnectionOptions): JobQueueProducers {
  return {
    appSync: createQueueProducer<AppSyncJobData>({
      queueName: QUEUE_NAMES.appSync,
      jobName: 'sync-app',
      component: 'worker-job-queues',
      spanName: 'queue.app_sync.enqueue',
      connection,
      jobOptions: QUEUE_JOB_OPTIONS[QUEUE_NAMES.appSync],
      fallbackCorrelationId: (job) => `app-${job.appCapabilityConfigId}`,
      jobId: (job) => `app-sync-${job.appCapabilityConfigId}`,
      spanAttributes: (job) => ({
        'aaa.app_capability_config.id': job.appCapabilityConfigId,
      }),
      log: {
        event: 'app.sync.enqueued',
        message: 'App sync job enqueued',
        context: (job) => ({
          appCapabilityConfigId: job.appCapabilityConfigId,
        }),
        fields: (job) => ({
          appKind: job.appKind,
          appCapability: job.capability,
        }),
      },
    }),
    ingestion: createQueueProducer<IngestionJobData>({
      queueName: QUEUE_NAMES.ingestion,
      jobName: 'ingest-document',
      component: 'worker-job-queues',
      spanName: 'queue.ingestion.enqueue',
      connection,
      jobOptions: QUEUE_JOB_OPTIONS[QUEUE_NAMES.ingestion],
      fallbackCorrelationId: (job) => `ingestion-${job.documentId}`,
      jobId: (job) => `ingest-${job.documentId}`,
      spanAttributes: (job) => ({
        'aaa.document.id': job.documentId,
      }),
      log: {
        event: 'ingestion.enqueued',
        message: 'Ingestion job enqueued',
        context: (job) => ({
          documentId: job.documentId,
        }),
        fields: (job) => ({
          sourceId: job.sourceId,
          externalId: job.externalId,
          appKind: job.appKind,
        }),
      },
    }),
    embedding: createQueueProducer<EmbeddingJobData>({
      queueName: QUEUE_NAMES.embedding,
      jobName: 'embed-chunks',
      component: 'worker-job-queues',
      spanName: 'queue.embedding.enqueue',
      connection,
      jobOptions: QUEUE_JOB_OPTIONS[QUEUE_NAMES.embedding],
      fallbackCorrelationId: (job) => `embedding-${job.chunkIds[0] ?? 'batch'}`,
      log: {
        event: 'embedding.enqueued',
        message: 'Embedding job enqueued',
        fields: (job) => ({
          chunkCount: job.chunkIds.length,
          model: job.model,
        }),
      },
    }),
  };
}

export function initializeJobQueues(config: WorkerConfig): void {
  producers = createJobQueueProducers(parseRedisUrl(config.redisUrl));
}

function getProducers(): JobQueueProducers {
  if (!producers) {
    throw new Error('Job queues have not been initialized');
  }
  return producers;
}

export async function enqueueAppSyncJob(job: AppSyncJobData): Promise<void> {
  await getProducers().appSync.enqueue(job);
}

export async function enqueueIngestionJob(job: IngestionJobData): Promise<void> {
  await getProducers().ingestion.enqueue(job);
}

export async function enqueueEmbeddingJob(job: EmbeddingJobData): Promise<void> {
  await getProducers().embedding.enqueue(job);
}

export async function closeJobQueues(): Promise<void> {
  if (!producers) {
    return;
  }

  const current = producers;
  producers = null;
  await Promise.all([current.appSync.close(), current.ingestion.close(), current.embedding.close()]);
}
