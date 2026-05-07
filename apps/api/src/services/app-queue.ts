import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl } from '@aaa/config';
import { createQueueProducer, type QueueProducer } from '@aaa/queues';
import type { AppSyncJobData } from '@aaa/shared';
import type { AppConfig } from '../config.js';

let producer: QueueProducer<AppSyncJobData> | null = null;

export type EnqueueAppSyncJob = (job: AppSyncJobData) => Promise<void>;

export function configureAppSyncQueue(config: Pick<AppConfig, 'redisUrl'>): EnqueueAppSyncJob {
  producer = createQueueProducer<AppSyncJobData>({
    queueName: QUEUE_NAMES.appSync,
    jobName: 'sync-app',
    component: 'worker-job-queues',
    spanName: 'queue.app_sync.enqueue',
    connection: parseRedisUrl(config.redisUrl),
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
  });
  return enqueueAppSyncJob;
}

export async function enqueueAppSyncJob(job: AppSyncJobData): Promise<void> {
  if (!producer) {
    throw new Error('App sync queue has not been configured');
  }

  await producer.enqueue(job);
}

export async function closeAppSyncQueue(): Promise<void> {
  if (!producer) {
    return;
  }
  const current = producer;
  producer = null;
  await current.close();
}
