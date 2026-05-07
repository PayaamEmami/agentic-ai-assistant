import { QUEUE_JOB_OPTIONS, QUEUE_NAMES, parseRedisUrl, type WorkerConfig } from '@aaa/config';
import { createQueueProducer, type QueueProducer } from '@aaa/queues';
import type { ChatContinuationJobData } from '@aaa/shared';

let producer: QueueProducer<ChatContinuationJobData> | null = null;

export function initializeChatContinuationQueue(config: WorkerConfig): void {
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
}

export async function enqueueChatContinuationJob(job: ChatContinuationJobData): Promise<void> {
  if (!producer) {
    throw new Error('Chat continuation queue has not been initialized');
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
