import { Queue } from 'bullmq';
import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, loadApiConfig, parseRedisUrl } from '@aaa/config';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';
import type { ToolExecutionJobData } from '@aaa/shared';

let queue: Queue<ToolExecutionJobData> | null = null;

function getQueue(): Queue<ToolExecutionJobData> {
  if (!queue) {
    queue = new Queue<ToolExecutionJobData>(QUEUE_NAMES.toolExecution, {
      connection: parseRedisUrl(loadApiConfig().redisUrl),
    });
  }
  return queue;
}

export async function enqueueToolExecutionJob(job: ToolExecutionJobData): Promise<void> {
  const correlationId =
    job.correlationId || getLogContext().correlationId || `tool-${job.toolExecutionId}`;
  const payload = {
    ...job,
    correlationId,
  };

  await withSpan(
    'queue.tool_execution.enqueue',
    {
      'aaa.queue.name': QUEUE_NAMES.toolExecution,
      'aaa.tool_execution.id': job.toolExecutionId,
    },
    () =>
      getQueue().add('execute-tool', payload, {
        ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.toolExecution],
      }),
  );
  getLogger({
    component: 'tool-execution-queue',
    toolExecutionId: job.toolExecutionId,
    conversationId: job.conversationId,
    correlationId,
  }).info(
    {
      event: 'tool.execution.enqueued',
      outcome: 'accepted',
      toolName: job.toolName,
    },
    'Tool execution job enqueued',
  );
}

export async function closeToolExecutionQueue(): Promise<void> {
  if (!queue) {
    return;
  }

  await queue.close();
  queue = null;
}
