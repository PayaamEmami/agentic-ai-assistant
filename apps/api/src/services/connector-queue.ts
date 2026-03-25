import { Queue } from 'bullmq';
import { getLogContext, getLogger } from '@aaa/observability';

export interface ConnectorSyncJobData {
  connectorConfigId: string;
  userId: string;
  connectorKind: 'github' | 'google_docs';
  correlationId: string;
}

let queue: Queue<ConnectorSyncJobData> | null = null;

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

function getQueue(): Queue<ConnectorSyncJobData> {
  if (!queue) {
    queue = new Queue<ConnectorSyncJobData>('connector-sync', {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
  }
  return queue;
}

export async function enqueueConnectorSyncJob(job: ConnectorSyncJobData): Promise<void> {
  const correlationId = job.correlationId || getLogContext().correlationId || `connector-${job.connectorConfigId}`;
  const payload = {
    ...job,
    correlationId,
  };

  await getQueue().add('sync-connector', payload, {
    jobId: `connector-sync:${job.connectorConfigId}`,
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  getLogger({
    component: 'connector-queue',
    connectorKind: job.connectorKind,
    connectorConfigId: job.connectorConfigId,
    correlationId,
  }).info(
    {
      event: 'connector.sync.enqueued',
      outcome: 'accepted',
    },
    'Connector sync job enqueued',
  );
}

export async function closeConnectorSyncQueue(): Promise<void> {
  if (!queue) {
    return;
  }

  await queue.close();
  queue = null;
}
