import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl } from '@aaa/config';
import { createQueueProducer, type QueueProducer } from '@aaa/queues';
import type { ToolExecutionJobData } from '@aaa/shared';
import type { AppConfig } from '../config.js';

let producer: QueueProducer<ToolExecutionJobData> | null = null;

export type EnqueueToolExecutionJob = (job: ToolExecutionJobData) => Promise<void>;

export function configureToolExecutionQueue(config: Pick<AppConfig, 'redisUrl'>): EnqueueToolExecutionJob {
  producer = createQueueProducer<ToolExecutionJobData>({
    queueName: QUEUE_NAMES.toolExecution,
    jobName: 'execute-tool',
    component: 'tool-execution-queue',
    spanName: 'queue.tool_execution.enqueue',
    connection: parseRedisUrl(config.redisUrl),
    jobOptions: QUEUE_JOB_OPTIONS[QUEUE_NAMES.toolExecution],
    fallbackCorrelationId: (job) => `tool-${job.toolExecutionId}`,
    jobId: (job) => `tool-execution-${job.toolExecutionId}`,
    spanAttributes: (job) => ({
      'aaa.tool_execution.id': job.toolExecutionId,
    }),
    log: {
      event: 'tool.execution.enqueued',
      message: 'Tool execution job enqueued',
      context: (job) => ({
        toolExecutionId: job.toolExecutionId,
        conversationId: job.conversationId,
      }),
      fields: (job) => ({
        toolName: job.toolName,
      }),
    },
  });
  return enqueueToolExecutionJob;
}

export async function enqueueToolExecutionJob(job: ToolExecutionJobData): Promise<void> {
  if (!producer) {
    throw new Error('Tool execution queue has not been configured');
  }

  await producer.enqueue(job);
}

export async function closeToolExecutionQueue(): Promise<void> {
  if (!producer) {
    return;
  }

  const current = producer;
  producer = null;
  await current.close();
}
