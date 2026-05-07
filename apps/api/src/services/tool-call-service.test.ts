import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApprovalDescription, createToolCall, stageToolCall } from './tool-call-service.js';
import type { AvailableTool } from './tools-loader.js';

const mocks = vi.hoisted(() => ({
  createToolExecution: vi.fn(),
  updateToolExecutionStatus: vi.fn(),
  setApproval: vi.fn(),
  createApproval: vi.fn(),
  broadcast: vi.fn(),
  enqueueToolExecutionJob: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  toolExecutionRepository: {
    create: mocks.createToolExecution,
    updateStatus: mocks.updateToolExecutionStatus,
    setApproval: mocks.setApproval,
  },
  approvalRepository: {
    create: mocks.createApproval,
  },
}));

vi.mock('@aaa/observability', () => ({
  getLogContext: () => ({ correlationId: 'correlation-1' }),
}));

vi.mock('../ws/connections.js', () => ({
  broadcast: mocks.broadcast,
}));

vi.mock('./tool-execution-queue.js', () => ({
  enqueueToolExecutionJob: mocks.enqueueToolExecutionJob,
}));

function tool(name: string, description = 'Run the selected tool'): AvailableTool {
  return {
    name,
    description,
    parameters: {},
    requiresApproval: true,
  };
}

describe('buildApprovalDescription', () => {
  it('describes GitHub pull request review approvals from structured input', () => {
    expect(
      buildApprovalDescription(tool('github.submit_pull_request_review'), {
        repo: 'owner/repo',
        pullNumber: 42,
        event: 'REQUEST_CHANGES',
      }),
    ).toBe('Allow requesting changes on a pull request for PR #42 in owner/repo');
  });

  it('truncates long coding task labels', () => {
    const description = buildApprovalDescription(tool('github.coding_task'), {
      repo: 'owner/repo',
      task: 'x'.repeat(120),
    });

    expect(description).toMatch(/^Allow running this coding task in owner\/repo: x+\.\.\.$/);
    expect(description.length).toBeLessThan(130);
  });

  it('falls back to a lower-cased tool description', () => {
    expect(buildApprovalDescription(tool('custom.tool', 'Create a thing'), {})).toBe(
      'Allow create a thing',
    );
  });
});

describe('tool-call orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createToolExecution.mockResolvedValue({ id: 'tool-execution-1' });
    mocks.createApproval.mockResolvedValue({
      id: 'approval-1',
      description: 'Allow creating a pull request in owner/repo',
    });
  });

  it('stages approval tool calls without broadcasting before finalization', async () => {
    const staged = await stageToolCall({
      conversationId: 'conversation-1',
      userId: 'user-1',
      tool: tool('github.create_pull_request'),
      input: { repo: 'owner/repo' },
      messageId: null,
      originMode: 'text',
    });

    expect(mocks.createToolExecution).toHaveBeenCalledWith(
      'conversation-1',
      null,
      'github.create_pull_request',
      { repo: 'owner/repo' },
      { originMode: 'text' },
    );
    expect(mocks.updateToolExecutionStatus).toHaveBeenCalledWith(
      'tool-execution-1',
      'requires_approval',
    );
    expect(mocks.setApproval).toHaveBeenCalledWith('tool-execution-1', 'approval-1');
    expect(staged).toMatchObject({
      toolExecutionId: 'tool-execution-1',
      status: 'requires_approval',
      approvalId: 'approval-1',
      approvalEvent: {
        type: 'approval.requested',
        conversationId: 'conversation-1',
        approvalId: 'approval-1',
      },
    });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.enqueueToolExecutionJob).not.toHaveBeenCalled();
  });

  it('creates and enqueues non-approval tool calls for immediate voice flow', async () => {
    const enqueueToolExecutionJob = vi.fn();
    await createToolCall({
      conversationId: 'conversation-1',
      userId: 'user-1',
      tool: { ...tool('time.now'), requiresApproval: false },
      input: {},
      messageId: 'message-1',
      originMode: 'voice',
      enqueueToolExecutionJob,
    });

    expect(enqueueToolExecutionJob).toHaveBeenCalledWith({
      toolExecutionId: 'tool-execution-1',
      toolName: 'time.now',
      input: {},
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    });
  });
});
