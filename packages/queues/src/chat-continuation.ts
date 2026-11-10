import { QUEUE_JOB_OPTIONS, QUEUE_NAMES } from '@aaa/config';
import type { ChatContinuationJobData } from '@aaa/shared';
import type { ConnectionOptions } from 'bullmq';
import { createQueueProducer, type QueueProducer } from './producer.js';

export function createChatContinuationProducer(
  connection: ConnectionOptions,
): QueueProducer<ChatContinuationJobData> {
  return createQueueProducer<ChatContinuationJobData>({
    queueName: QUEUE_NAMES.chatContinuation,
    jobName: 'continue-chat',
    component: 'chat-continuation-queue',
    spanName: 'queue.chat_continuation.enqueue',
    connection,
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
