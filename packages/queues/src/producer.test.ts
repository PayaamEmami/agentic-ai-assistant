import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueueProducer } from './producer.js';

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

describe('createQueueProducer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue.mockImplementation(function Queue() {
      return {
      add: mocks.add,
      close: mocks.close,
      };
    });
    mocks.getLogContext.mockReturnValue({ correlationId: 'context-correlation' });
    mocks.getLogger.mockReturnValue({ info: mocks.loggerInfo });
    mocks.withSpan.mockImplementation((_name, _attributes, handler) => handler());
  });

  it('enqueues payloads with shared correlation, job options, job id, span, and log behavior', async () => {
    const producer = createQueueProducer({
      queueName: 'test-queue',
      jobName: 'test-job',
      component: 'test-producer',
      spanName: 'queue.test.enqueue',
      connection: { host: 'localhost', port: 6379 },
      jobOptions: { attempts: 2 },
      fallbackCorrelationId: (job) => `fallback-${job.id}`,
      jobId: (job) => `job-${job.id}`,
      spanAttributes: (job) => ({ 'aaa.job.id': job.id }),
      log: {
        event: 'test.enqueued',
        message: 'Test job enqueued',
        context: (job) => ({ jobId: job.id }),
        fields: (job) => ({ value: job.value }),
      },
    });

    await producer.enqueue({ id: '123', value: 42, correlationId: '' });

    expect(mocks.queue).toHaveBeenCalledWith('test-queue', {
      connection: { host: 'localhost', port: 6379 },
    });
    expect(mocks.withSpan).toHaveBeenCalledWith(
      'queue.test.enqueue',
      {
        'aaa.queue.name': 'test-queue',
        'aaa.job.id': '123',
      },
      expect.any(Function),
    );
    expect(mocks.add).toHaveBeenCalledWith(
      'test-job',
      { id: '123', value: 42, correlationId: 'context-correlation' },
      { attempts: 2, jobId: 'job-123' },
    );
    expect(mocks.getLogger).toHaveBeenCalledWith({
      component: 'test-producer',
      correlationId: 'context-correlation',
      jobId: '123',
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      { event: 'test.enqueued', outcome: 'accepted', value: 42 },
      'Test job enqueued',
    );
  });
});
