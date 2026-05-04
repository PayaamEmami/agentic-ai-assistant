import { Queue } from 'bullmq';
import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, loadWorkerConfig, parseRedisUrl } from '@aaa/config';
import { getLogContext, getLogger, withSpan } from '@aaa/observability';
import type { ChatContinuationJobData } from '@aaa/shared';

let queue: Queue<ChatContinuationJobData> | null = null;

function getQueue(): Queue<ChatContinuationJobData> {
  if (!queue) {
    queue = new Queue<ChatContinuationJobData>(QUEUE_NAMES.chatContinuation, {
      connection: parseRedisUrl(loadWorkerConfig().redisUrl),
    });
  }
  return queue;
}

export async function enqueueChatContinuationJob(job: ChatContinuationJobData): Promise<void> {
  const correlationId =
    job.correlationId || getLogContext().correlationId || `continue-${job.toolExecutionId}`;
  const payload = {
    ...job,
    correlationId,
  };

  await withSpan(
    'queue.chat_continuation.enqueue',
    {
      'aaa.queue.name': QUEUE_NAMES.chatContinuation,
      'aaa.tool_execution.id': job.toolExecutionId,
      'aaa.conversation.id': job.conversationId,
    },
    () =>
      getQueue().add('continue-chat', payload, {
        ...QUEUE_JOB_OPTIONS[QUEUE_NAMES.chatContinuation],
        jobId: `chat-continuation-${job.toolExecutionId}`,
      }),
  );

  getLogger({
    component: 'chat-continuation-queue',
    toolExecutionId: job.toolExecutionId,
    conversationId: job.conversationId,
    correlationId,
  }).info(
    {
      event: 'chat.continuation.enqueued',
      outcome: 'accepted',
    },
    'Chat continuation job enqueued',
  );
}

export async function closeChatContinuationQueue(): Promise<void> {
  if (!queue) {
    return;
  }
  await queue.close();
  queue = null;
}
