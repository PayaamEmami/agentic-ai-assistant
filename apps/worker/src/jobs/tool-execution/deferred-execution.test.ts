import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { ToolExecutionJobData } from '@aaa/shared';
import { handleToolExecution } from './index.js';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    findExecution: vi.fn(),
    findConversation: vi.fn(),
    claim: vi.fn(),
    findActiveByConversation: vi.fn(),
    touch: vi.fn(),
    executeTool: vi.fn(),
    updateStatus: vi.fn(),
    enqueueChatContinuationJob: vi.fn(),
    publishToolEvent: vi.fn(),
    updateInlineToolResult: vi.fn(),
  },
}));

vi.mock('@aaa/db', () => ({
  conversationRepository: {
    findById: mocks.findConversation,
  },
  toolExecutionRepository: {
    findById: mocks.findExecution,
    claimForExecution: mocks.claim,
    updateStatus: mocks.updateStatus,
  },
  automationRunRepository: {
    findActiveByConversation: mocks.findActiveByConversation,
    touch: mocks.touch,
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./handlers.js', () => ({
  executeTool: mocks.executeTool,
}));

describe('handleToolExecution deferred coding tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const execution = {
      id: 'tool-1',
      messageId: 'message-1',
      originMode: 'text',
      status: 'pending',
      input: {},
    };
    mocks.findExecution.mockResolvedValue(execution);
    mocks.claim.mockResolvedValue(execution);
    mocks.findConversation.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', isAutomation: false });
  });

  it('does not finish the tool or continue the chat when the coding run is accepted', async () => {
    mocks.executeTool.mockResolvedValue({ deferred: true });
    const job = {
      id: 'job-1',
      data: {
        toolExecutionId: 'tool-1',
        toolName: 'github.coding_task',
        input: {},
        conversationId: 'conversation-1',
        correlationId: 'corr-1',
      },
    } as Job<ToolExecutionJobData>;

    await handleToolExecution(job);

    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.enqueueChatContinuationJob).not.toHaveBeenCalled();
  });
});
