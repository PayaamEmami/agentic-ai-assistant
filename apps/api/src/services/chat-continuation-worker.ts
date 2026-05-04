import { Worker } from 'bullmq';
import { QUEUE_NAMES, parseRedisUrl } from '@aaa/config';
import { getLogger, withLogContext, withSpan } from '@aaa/observability';
import type { ChatContinuationJobData } from '@aaa/shared';
import type { AppConfig } from '../config.js';
import type { ChatService } from './chat-service.js';

let worker: Worker<ChatContinuationJobData> | null = null;

export function startChatContinuationWorker(
  config: AppConfig,
  chatService: ChatService,
): Worker<ChatContinuationJobData> {
  if (worker) {
    return worker;
  }

  worker = new Worker<ChatContinuationJobData>(
    QUEUE_NAMES.chatContinuation,
    (job) =>
      withLogContext(
        {
          component: 'chat-continuation-worker',
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
          conversationId: job.data.conversationId,
          toolExecutionId: job.data.toolExecutionId,
        },
        () =>
          withSpan(
            'worker.job.chat_continuation',
            {
              'aaa.queue.name': job.queueName,
              'aaa.job.id': job.id ?? 'unknown',
            },
            async () => {
              await chatService.continueAfterToolExecution(job.data.toolExecutionId);
            },
          ),
      ),
    {
      connection: parseRedisUrl(config.redisUrl),
    },
  );

  worker.on('failed', (job, error) => {
    getLogger({
      component: 'chat-continuation-worker',
      queue: job?.queueName,
      jobId: job?.id,
      correlationId: job?.data?.correlationId,
      conversationId: job?.data?.conversationId,
      toolExecutionId: job?.data?.toolExecutionId,
    }).error(
      {
        event: 'chat.continuation.failed',
        outcome: 'failure',
        error,
      },
      'Chat continuation job failed',
    );
  });

  return worker;
}

export async function stopChatContinuationWorker(): Promise<void> {
  if (!worker) {
    return;
  }
  const current = worker;
  worker = null;
  await current.close();
}
