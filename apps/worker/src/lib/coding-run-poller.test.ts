import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodingAgent, CodingAgentSnapshot } from '@aaa/tool-providers';
import type { CodingRun } from '@aaa/db';
import { finishCodingRun, pollCodingRuns } from './coding-run-poller.js';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    listRunning: vi.fn(),
    settleIfRunning: vi.fn(),
    finishIfRunning: vi.fn(),
    findConversation: vi.fn(),
    findActiveByConversation: vi.fn(),
    touch: vi.fn(),
    updateInlineToolResult: vi.fn(),
    publishToolEvent: vi.fn(),
    enqueueChatContinuationJob: vi.fn(),
  },
}));

vi.mock('@aaa/db', () => ({
  codingRunRepository: {
    listRunning: mocks.listRunning,
    settleIfRunning: mocks.settleIfRunning,
  },
  toolExecutionRepository: {
    finishIfRunning: mocks.finishIfRunning,
  },
  conversationRepository: {
    findById: mocks.findConversation,
  },
  automationRunRepository: {
    findActiveByConversation: mocks.findActiveByConversation,
    touch: mocks.touch,
  },
}));

vi.mock('../jobs/tool-execution/events.js', () => ({
  updateInlineToolResult: mocks.updateInlineToolResult,
  publishToolEvent: mocks.publishToolEvent,
}));

vi.mock('./chat-continuation-queue.js', () => ({
  enqueueChatContinuationJob: mocks.enqueueChatContinuationJob,
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function run(overrides: Partial<CodingRun> = {}): CodingRun {
  return {
    id: 'coding-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    toolExecutionId: 'tool-1',
    providerId: 'cursor',
    externalId: 'bc-1',
    repo: 'owner/repo',
    status: 'running',
    summary: null,
    branch: null,
    pullRequestUrl: null,
    correlationId: 'corr-1',
    createdAt: new Date('2026-11-10T10:00:00Z'),
    updatedAt: new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  };
}

function agent(snapshot: CodingAgentSnapshot): CodingAgent {
  return {
    providerId: 'cursor',
    start: vi.fn(),
    fetch: vi.fn().mockResolvedValue(snapshot),
  };
}

describe('pollCodingRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findConversation.mockResolvedValue({ isAutomation: true });
    mocks.findActiveByConversation.mockResolvedValue({ id: 'auto-1' });
    mocks.touch.mockResolvedValue(true);
    mocks.settleIfRunning.mockResolvedValue(run({ status: 'finished' }));
    mocks.finishIfRunning.mockResolvedValue({
      id: 'tool-1',
      messageId: 'message-1',
      originMode: 'text',
      toolName: 'github.coding_task',
    });
  });

  it('refreshes an automation heartbeat while the run is still going', async () => {
    mocks.listRunning.mockResolvedValue([run()]);
    await pollCodingRuns(agent({ status: 'running' }), new Date('2026-11-10T10:05:00Z'));

    expect(mocks.touch).toHaveBeenCalledWith('auto-1');
    expect(mocks.finishIfRunning).not.toHaveBeenCalled();
    expect(mocks.enqueueChatContinuationJob).not.toHaveBeenCalled();
  });

  it('continues the chat once for a summary with no links', async () => {
    mocks.listRunning.mockResolvedValue([run()]);
    await pollCodingRuns(
      agent({ status: 'finished', summary: 'Merged the fix.' }),
      new Date('2026-11-10T10:05:00Z'),
    );

    expect(mocks.finishIfRunning).toHaveBeenCalledWith('tool-1', 'completed', {
      summary: 'Merged the fix.',
      repo: 'owner/repo',
    });
    expect(mocks.settleIfRunning).toHaveBeenCalledWith('coding-1', {
      status: 'finished',
      summary: 'Merged the fix.',
      branch: null,
      pullRequestUrl: null,
    });
    expect(mocks.enqueueChatContinuationJob).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueChatContinuationJob).toHaveBeenCalledWith({
      toolExecutionId: 'tool-1',
      conversationId: 'conversation-1',
      correlationId: 'corr-1',
    });
  });

  it('stores a branch and pull request when the run produced them', async () => {
    mocks.listRunning.mockResolvedValue([run()]);
    await pollCodingRuns(
      agent({
        status: 'finished',
        summary: 'Pushed the branch.',
        branch: 'agent/fix',
        pullRequestUrl: 'https://github.com/owner/repo/pull/3',
      }),
      new Date('2026-11-10T10:05:00Z'),
    );

    expect(mocks.finishIfRunning).toHaveBeenCalledWith('tool-1', 'completed', {
      summary: 'Pushed the branch.',
      repo: 'owner/repo',
      branch: 'agent/fix',
      pullRequestUrl: 'https://github.com/owner/repo/pull/3',
    });
  });

  it('does not continue the chat when the tool execution was already finished', async () => {
    mocks.finishIfRunning.mockResolvedValue(null);
    await finishCodingRun(run(), { status: 'finished', summary: 'Done.' });
    expect(mocks.enqueueChatContinuationJob).not.toHaveBeenCalled();
    expect(mocks.publishToolEvent).not.toHaveBeenCalled();
  });

  it('fails a run that is still open after two hours', async () => {
    mocks.listRunning.mockResolvedValue([run()]);
    await pollCodingRuns(agent({ status: 'running' }), new Date('2026-11-10T12:00:00Z'));

    expect(mocks.finishIfRunning).toHaveBeenCalledWith('tool-1', 'failed', {
      error: 'The coding task did not finish.',
    });
    expect(mocks.enqueueChatContinuationJob).toHaveBeenCalledTimes(1);
  });
});
