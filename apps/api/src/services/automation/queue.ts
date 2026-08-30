import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl } from '@aaa/config';
import { createQueueProducer, type QueueProducer } from '@aaa/queues';
import type { AutomationJobData } from '@aaa/shared';
import type { AppConfig } from '../../config.js';

let producer: QueueProducer<AutomationJobData> | null = null;

export type EnqueueAutomationJob = (job: AutomationJobData) => Promise<void>;

export function configureAutomationQueue(
  config: Pick<AppConfig, 'redisUrl'>,
): EnqueueAutomationJob {
  producer = createQueueProducer<AutomationJobData>({
    queueName: QUEUE_NAMES.automation,
    jobName: 'automation-board-task',
    component: 'automation-queue',
    spanName: 'queue.automation.enqueue',
    connection: parseRedisUrl(config.redisUrl),
    jobOptions: QUEUE_JOB_OPTIONS[QUEUE_NAMES.automation],
    fallbackCorrelationId: (job) => `automation-${job.runId}`,
    jobId: (job) => `automation-run-${job.runId}`,
    spanAttributes: (job) => ({
      'aaa.automation.run_id': job.runId,
    }),
    log: {
      event: 'automation.run.enqueued',
      message: 'Automation run enqueued',
      context: (job) => ({
        automationRunId: job.runId,
      }),
      fields: (job) => ({
        scheduleId: job.scheduleId,
      }),
    },
  });
  return enqueueAutomationJob;
}

export async function enqueueAutomationJob(job: AutomationJobData): Promise<void> {
  if (!producer) {
    throw new Error('Automation queue has not been configured');
  }

  await producer.enqueue(job);
}

export async function closeAutomationQueue(): Promise<void> {
  if (!producer) {
    return;
  }

  const current = producer;
  producer = null;
  await current.close();
}
