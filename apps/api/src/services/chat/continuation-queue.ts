import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl } from '@aaa/config';
import { createQueueProducer, type QueueProducer } from '@aaa/queues';
import type { ChatContinuationJobData } from '@aaa/shared';
import type { AppConfig } from '../../config.js';

let producer: QueueProducer<ChatContinuationJobData> | null = null;

export type EnqueueChatContinuationJob = (job: ChatContinuationJobData) => Promise<void>;

export function configureChatContinuationQueue(
  config: Pick<AppConfig, 'redisUrl'>,
): EnqueueChatContinuationJob {
  producer = createQueueProducer<ChatContinuationJobData>({
    queueName: QUEUE_NAMES.chatContinuation,
    jobName: 'continue-chat',
    component: 'chat-continuation-queue',
    spanName: 'queue.chat_continuation.enqueue',
    connection: parseRedisUrl(config.redisUrl),
    jobOptions: QUEUE_JOB_OPTIONS[QUEUE_NAMES.chatContinuation],
    fallbackCorrelationId: (job) => `continue-${job.toolExecutionId}`,
    jobId: (job) => `chat-continuation-${job.toolExecutionId}`,
    spanAttributes: (job) => ({
      'aaa.tool_execution.id': job.toolExecutionId,
      'aaa.conversation.id': job.conversationId,
    }),
    log: {
      event: 'chat.continuation.enqueued',
      message: 'Chat continuation job enqueued',
      context: (job) => ({
        toolExecutionId: job.toolExecutionId,
        conversationId: job.conversationId,
      }),
    },
  });
  return enqueueChatContinuationJob;
}

export async function enqueueChatContinuationJob(job: ChatContinuationJobData): Promise<void> {
  if (!producer) {
    throw new Error('Chat continuation queue has not been configured');
  }

  await producer.enqueue(job);
}

export async function closeChatContinuationQueue(): Promise<void> {
  if (!producer) {
    return;
  }

  const current = producer;
  producer = null;
  await current.close();
}
