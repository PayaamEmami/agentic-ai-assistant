import { Queue } from 'bullmq';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';

export interface AppSyncJobData {
  appCapabilityConfigId: string;
  userId: string;
  appKind: 'github' | 'google';
  capability: 'knowledge';
  correlationId: string;
}

export interface IngestionJobData {
  appCapabilityConfigId: string;
  appKind: 'github' | 'google';
  documentId: string;
  sourceId: string;
  userId: string;
  externalId: string;
  correlationId: string;
}

export interface EmbeddingJobData {
  chunkIds: string[];
  model: string;
  correlationId: string;
}

let appSyncQueue: Queue<AppSyncJobData> | null = null;
let ingestionQueue: Queue<IngestionJobData> | null = null;
let embeddingQueue: Queue<EmbeddingJobData> | null = null;

function createSafeJobId(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts.map((part) => Buffer.from(part).toString('base64url'))].join('-');
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

function getAppSyncQueue(): Queue<AppSyncJobData> {
  if (!appSyncQueue) {
    appSyncQueue = new Queue<AppSyncJobData>('app-sync', {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
  }
  return appSyncQueue;
}

function getIngestionQueue(): Queue<IngestionJobData> {
  if (!ingestionQueue) {
    ingestionQueue = new Queue<IngestionJobData>('ingestion', {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
  }
  return ingestionQueue;
}

function getEmbeddingQueue(): Queue<EmbeddingJobData> {
  if (!embeddingQueue) {
    embeddingQueue = new Queue<EmbeddingJobData>('embedding', {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
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
      'aaa.queue.name': 'app-sync',
      'aaa.app_capability_config.id': job.appCapabilityConfigId,
    },
    () =>
      getAppSyncQueue().add('sync-app', payload, {
        jobId: createSafeJobId('app-sync', job.appCapabilityConfigId),
        removeOnComplete: 100,
        removeOnFail: 500,
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
      'aaa.queue.name': 'ingestion',
      'aaa.document.id': job.documentId,
    },
    () =>
      getIngestionQueue().add('ingest-document', payload, {
        jobId: createSafeJobId('ingestion', job.documentId, job.externalId),
        removeOnComplete: 100,
        removeOnFail: 500,
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
      'aaa.queue.name': 'embedding',
    },
    () =>
      getEmbeddingQueue().add('embed-chunks', payload, {
        removeOnComplete: 100,
        removeOnFail: 500,
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
