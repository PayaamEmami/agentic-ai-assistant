import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodingAgent } from '@aaa/tool-providers';
import { CodingAgentError } from '@aaa/tool-providers';
import { acceptCodingTask } from './coding-task.js';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    create: vi.fn(),
    updateInlineToolResult: vi.fn(),
    publishToolEvent: vi.fn(),
  },
}));

vi.mock('@aaa/db', () => ({
  codingRunRepository: {
    create: mocks.create,
  },
}));

vi.mock('./events.js', () => ({
  updateInlineToolResult: mocks.updateInlineToolResult,
  publishToolEvent: mocks.publishToolEvent,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

function agent(start: CodingAgent['start']): CodingAgent {
  return {
    providerId: 'cursor',
    start,
    fetch: vi.fn(),
  };
}

describe('acceptCodingTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'run-1' });
  });

  it('records the external id and leaves the chat waiting', async () => {
    const start = vi.fn().mockResolvedValue({ externalId: 'bc-1' });
    const result = await acceptCodingTask({
      agent: agent(start),
      userId: 'user-1',
      conversationId: 'conversation-1',
      toolExecutionId: 'tool-1',
      toolName: 'github.coding_task',
      messageId: 'message-1',
      correlationId: 'corr-1',
      repo: 'owner/repo',
      task: 'Fix the test',
      baseBranch: 'main',
    });

    expect(result).toEqual({ deferred: true });
    expect(start).toHaveBeenCalledWith({
      repo: 'owner/repo',
      task: 'Fix the test',
      baseBranch: 'main',
      pullRequestUrl: undefined,
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'bc-1',
        providerId: 'cursor',
        repo: 'owner/repo',
        correlationId: 'corr-1',
      }),
    );
    expect(mocks.updateInlineToolResult).toHaveBeenCalledWith('message-1', 'tool-1', {
      status: 'running',
      detail: 'Working on owner/repo',
    });
  });

  it('does not record a run when the provider fails to start', async () => {
    const start = vi.fn().mockRejectedValue(
      new CodingAgentError('HTTP 404 repository not found', {
        userMessage: 'That repository is not available to the coding agent.',
      }),
    );

    const result = await acceptCodingTask({
      agent: agent(start),
      userId: 'user-1',
      conversationId: 'conversation-1',
      toolExecutionId: 'tool-1',
      toolName: 'github.coding_task',
      messageId: 'message-1',
      correlationId: 'corr-1',
      repo: 'owner/missing',
      task: 'Look around',
    });

    expect(result).toEqual({
      success: false,
      result: null,
      error: 'That repository is not available to the coding agent.',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
