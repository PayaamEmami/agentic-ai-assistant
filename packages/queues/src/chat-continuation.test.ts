import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatContinuationProducer } from './chat-continuation.js';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  queue: vi.fn(),
  getLogContext: vi.fn(),
  getLogger: vi.fn(),
  loggerInfo: vi.fn(),
  withSpan: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: mocks.queue,
}));

vi.mock('@aaa/observability', () => ({
  getLogContext: mocks.getLogContext,
  getLogger: mocks.getLogger,
  withSpan: mocks.withSpan,
}));

describe('createChatContinuationProducer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue.mockImplementation(function Queue() {
      return {
        add: mocks.add,
        close: mocks.close,
      };
    });
    mocks.getLogContext.mockReturnValue({});
    mocks.getLogger.mockReturnValue({ info: mocks.loggerInfo });
    mocks.withSpan.mockImplementation((_name, _attributes, handler) => handler());
  });

  it('enqueues one continuation per tool execution on the shared queue', async () => {
    const producer = createChatContinuationProducer({ host: '127.0.0.1', port: 6379 });

    await producer.enqueue({
      toolExecutionId: 'tool-1',
      conversationId: 'conv-1',
      correlationId: 'corr-1',
    });

    expect(mocks.queue).toHaveBeenCalledWith('chat-continuation', {
      connection: { host: '127.0.0.1', port: 6379 },
    });
    expect(mocks.add).toHaveBeenCalledWith(
      'continue-chat',
      {
        toolExecutionId: 'tool-1',
        conversationId: 'conv-1',
        correlationId: 'corr-1',
      },
      expect.objectContaining({
        attempts: 10,
        jobId: 'chat-continuation-tool-1',
      }),
    );
  });
});
