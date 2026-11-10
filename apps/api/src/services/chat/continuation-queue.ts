import { parseRedisUrl } from '@aaa/config';
import { createChatContinuationProducer, type QueueProducer } from '@aaa/queues';
import type { ChatContinuationJobData } from '@aaa/shared';
import type { AppConfig } from '../../config.js';

let producer: QueueProducer<ChatContinuationJobData> | null = null;

export type EnqueueChatContinuationJob = (job: ChatContinuationJobData) => Promise<void>;

export function configureChatContinuationQueue(
  config: Pick<AppConfig, 'redisUrl'>,
): EnqueueChatContinuationJob {
  producer = createChatContinuationProducer(parseRedisUrl(config.redisUrl));
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
