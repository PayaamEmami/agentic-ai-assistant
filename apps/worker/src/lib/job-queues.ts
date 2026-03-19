import { Queue } from 'bullmq';

export interface ConnectorSyncJobData {
  connectorConfigId: string;
  userId: string;
  connectorKind: 'github' | 'google_docs';
}

export interface IngestionJobData {
  connectorConfigId: string;
  documentId: string;
  sourceId: string;
  userId: string;
  externalId: string;
}

export interface EmbeddingJobData {
  chunkIds: string[];
  model: string;
}

let connectorSyncQueue: Queue<ConnectorSyncJobData> | null = null;
let ingestionQueue: Queue<IngestionJobData> | null = null;
let embeddingQueue: Queue<EmbeddingJobData> | null = null;

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

function getConnectorSyncQueue(): Queue<ConnectorSyncJobData> {
  if (!connectorSyncQueue) {
    connectorSyncQueue = new Queue<ConnectorSyncJobData>('connector-sync', {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
  }
  return connectorSyncQueue;
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

export async function enqueueConnectorSyncJob(job: ConnectorSyncJobData): Promise<void> {
  await getConnectorSyncQueue().add('sync-connector', job, {
    jobId: `connector-sync:${job.connectorConfigId}`,
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

export async function enqueueIngestionJob(job: IngestionJobData): Promise<void> {
  await getIngestionQueue().add('ingest-document', job, {
    jobId: `ingestion:${job.documentId}:${job.externalId}`,
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

export async function enqueueEmbeddingJob(job: EmbeddingJobData): Promise<void> {
  await getEmbeddingQueue().add('embed-chunks', job, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

export async function closeJobQueues(): Promise<void> {
  await Promise.all(
    [connectorSyncQueue, ingestionQueue, embeddingQueue]
      .filter((queue): queue is Queue => queue !== null)
      .map((queue) => queue.close()),
  );
  connectorSyncQueue = null;
  ingestionQueue = null;
  embeddingQueue = null;
}
