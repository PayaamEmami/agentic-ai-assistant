import { Queue } from 'bullmq';
import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl, loadApiConfig } from '@aaa/config';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';
import type { AppSyncJobData } from '@aaa/shared';

let appSyncQueue: Queue<AppSyncJobData> | null = null;

function getAppSyncQueue(): Queue<AppSyncJobData> {
  if (!appSyncQueue) {
    appSyncQueue = new Queue<AppSyncJobData>(QUEUE_NAMES.appSync, {
      connection: parseRedisUrl(loadApiConfig().redisUrl),
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
      'aaa.queue.name': QUEUE_NAMES.appSync,
      'aaa.app_capability_config.id': job.appCapabilityConfigId,
    },
    () =>
      getAppSyncQueue().add('sync-app', payload, {
        ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.appSync],
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
