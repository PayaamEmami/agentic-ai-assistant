import { Queue } from 'bullmq';
import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, loadWorkerConfig, parseRedisUrl } from '@aaa/config';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';
import type { AppSyncJobData, EmbeddingJobData, IngestionJobData } from '@aaa/shared';

let appSyncQueue: Queue<AppSyncJobData> | null = null;
let ingestionQueue: Queue<IngestionJobData> | null = null;
let embeddingQueue: Queue<EmbeddingJobData> | null = null;

function getAppSyncQueue(): Queue<AppSyncJobData> {
  if (!appSyncQueue) {
    appSyncQueue = new Queue<AppSyncJobData>(QUEUE_NAMES.appSync, {
      connection: parseRedisUrl(loadWorkerConfig().redisUrl),
    });
  }
  return appSyncQueue;
}

function getIngestionQueue(): Queue<IngestionJobData> {
  if (!ingestionQueue) {
    ingestionQueue = new Queue<IngestionJobData>(QUEUE_NAMES.ingestion, {
      connection: parseRedisUrl(loadWorkerConfig().redisUrl),
    });
  }
  return ingestionQueue;
}

function getEmbeddingQueue(): Queue<EmbeddingJobData> {
  if (!embeddingQueue) {
    embeddingQueue = new Queue<EmbeddingJobData>(QUEUE_NAMES.embedding, {
      connection: parseRedisUrl(loadWorkerConfig().redisUrl),
    });
  }
  return embeddingQueue;
}

export async function enqueueAppSyncJob(job: AppSyncJobData): Promise<void> {
  const correlationId =
    job.correlationId || getLogContext().correlationId || `app-${job.appCapabilityConfigId}`;
  const payload = {
    ...job,
    correlationId,
  };

  await withSpan(
    'queue.app_sync.enqueue',
    {
      'aaa.queue.name': QUEUE_NAMES.appSync,
      'aaa.app_capability_config.id': job.appCapabilityConfigId,
    },
    () =>
      getAppSyncQueue().add('sync-app', payload, {
        ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.appSync],
        jobId: `app-sync-${job.appCapabilityConfigId}`,
      }),
  );
  getLogger({
    component: 'worker-job-queues',
    appCapabilityConfigId: job.appCapabilityConfigId,
    correlationId,
  }).info(
    {
      event: 'app.sync.enqueued',
      outcome: 'accepted',
      appKind: job.appKind,
      appCapability: job.capability,
    },
    'App sync job enqueued',
  );
}

export async function enqueueIngestionJob(job: IngestionJobData): Promise<void> {
  const correlationId =
    job.correlationId || getLogContext().correlationId || `ingestion-${job.documentId}`;
  const payload = {
    ...job,
    correlationId,
  };

  await withSpan(
    'queue.ingestion.enqueue',
    {
      'aaa.queue.name': QUEUE_NAMES.ingestion,
      'aaa.document.id': job.documentId,
    },
    () =>
      getIngestionQueue().add('ingest-document', payload, {
        ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.ingestion],
        jobId: `ingest-${job.documentId}`,
      }),
  );
  getLogger({
    component: 'worker-job-queues',
    correlationId,
    documentId: job.documentId,
  }).info(
    {
      event: 'ingestion.enqueued',
      outcome: 'accepted',
      sourceId: job.sourceId,
      externalId: job.externalId,
      appKind: job.appKind,
    },
    'Ingestion job enqueued',
  );
}

export async function enqueueEmbeddingJob(job: EmbeddingJobData): Promise<void> {
  const correlationId =
    job.correlationId || getLogContext().correlationId || `embedding-${job.chunkIds[0] ?? 'batch'}`;
  const payload = {
    ...job,
    correlationId,
  };

  await withSpan(
    'queue.embedding.enqueue',
    {
      'aaa.queue.name': QUEUE_NAMES.embedding,
    },
    () =>
      getEmbeddingQueue().add('embed-chunks', payload, {
        ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.embedding],
      }),
  );
  getLogger({
    component: 'worker-job-queues',
    correlationId,
  }).info(
    {
      event: 'embedding.enqueued',
      outcome: 'accepted',
      chunkCount: job.chunkIds.length,
      model: job.model,
    },
    'Embedding job enqueued',
  );
}

export async function closeJobQueues(): Promise<void> {
  await Promise.all(
    [appSyncQueue, ingestionQueue, embeddingQueue]
      .filter((queue): queue is Queue => queue !== null)
      .map((queue) => queue.close()),
  );
  appSyncQueue = null;
  ingestionQueue = null;
  embeddingQueue = null;
}
