import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeToolExecution } from './index.js';

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  publishToolEvent: vi.fn(),
  updateInlineToolResult: vi.fn(),
  enqueueChatContinuationJob: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  conversationRepository: {
    findById: vi.fn(),
  },
  toolExecutionRepository: {
    findById: vi.fn(),
    updateStatus: mocks.updateStatus,
  },
}));

vi.mock('./events.js', () => ({
  publishToolEvent: mocks.publishToolEvent,
  updateInlineToolResult: mocks.updateInlineToolResult,
}));

vi.mock('../../lib/chat-continuation-queue.js', () => ({
  enqueueChatContinuationJob: mocks.enqueueChatContinuationJob,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

describe('finalizeToolExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks successful executions complete and enqueues chat continuation', async () => {
    await finalizeToolExecution({
      toolExecutionId: 'tool-1',
      toolName: 'echo',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
      messageId: 'message-1',
      originMode: 'chat',
      result: { success: true, result: { echo: 'hello' } },
    });

    expect(mocks.updateStatus).toHaveBeenCalledWith('tool-1', 'completed', { echo: 'hello' });
    expect(mocks.updateInlineToolResult).toHaveBeenCalledWith('message-1', 'tool-1', {
      status: 'completed',
      output: { echo: 'hello' },
      detail: undefined,
    });
    expect(mocks.publishToolEvent).toHaveBeenCalledWith({
      type: 'tool.done',
      conversationId: 'conversation-1',
      toolExecutionId: 'tool-1',
      toolName: 'echo',
      output: { echo: 'hello' },
      status: 'completed',
    });
    expect(mocks.enqueueChatContinuationJob).toHaveBeenCalledWith({
      toolExecutionId: 'tool-1',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    });
  });

  it('marks failed voice executions failed and skips chat continuation', async () => {
    await finalizeToolExecution({
      toolExecutionId: 'tool-1',
      toolName: 'echo',
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
      messageId: 'message-1',
      originMode: 'voice',
      result: { success: false, result: null, error: 'boom' },
    });

    expect(mocks.updateStatus).toHaveBeenCalledWith('tool-1', 'failed', { error: 'boom' });
    expect(mocks.updateInlineToolResult).toHaveBeenCalledWith('message-1', 'tool-1', {
      status: 'failed',
      output: { error: 'boom' },
      detail: undefined,
    });
    expect(mocks.publishToolEvent).toHaveBeenCalledWith({
      type: 'tool.done',
      conversationId: 'conversation-1',
      toolExecutionId: 'tool-1',
      toolName: 'echo',
      output: { error: 'boom' },
      status: 'failed',
    });
    expect(mocks.enqueueChatContinuationJob).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tool.execution.continuation_skipped',
        reason: 'voice_origin',
      }),
      'Skipping HTTP continuation for voice-origin tool execution',
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tool.execution.completed',
        outcome: 'failure',
        error: 'boom',
      }),
      'Tool execution failed',
    );
  });
});
