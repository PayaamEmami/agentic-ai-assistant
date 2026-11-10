import { parseRedisUrl, type WorkerConfig } from '@aaa/config';
import { createChatContinuationProducer, type QueueProducer } from '@aaa/queues';
import type { ChatContinuationJobData } from '@aaa/shared';

let producer: QueueProducer<ChatContinuationJobData> | null = null;

export function initializeChatContinuationQueue(config: WorkerConfig): void {
  producer = createChatContinuationProducer(parseRedisUrl(config.redisUrl));
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
