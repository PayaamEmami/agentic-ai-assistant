import { Queue } from 'bullmq';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';

export interface AppSyncJobData {
  appCapabilityConfigId: string;
  userId: string;
  appKind: 'github' | 'google';
  capability: 'knowledge';
  correlationId: string;
}

let appSyncQueue: Queue<AppSyncJobData> | null = null;

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

export async function closeAppSyncQueue(): Promise<void> {
  if (appSyncQueue) {
    await appSyncQueue.close();
  }
  appSyncQueue = null;
}
