import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalService } from './approval-service.js';

const mocks = vi.hoisted(() => ({
  findApprovalById: vi.fn(),
  decideApproval: vi.fn(),
  findToolExecutionById: vi.fn(),
  updateToolExecutionStatus: vi.fn(),
  updateToolResultBlock: vi.fn(),
  enqueueToolExecutionJob: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  approvalRepository: {
    findById: mocks.findApprovalById,
    decide: mocks.decideApproval,
    listPendingByUser: vi.fn(),
  },
  toolExecutionRepository: {
    findById: mocks.findToolExecutionById,
    updateStatus: mocks.updateToolExecutionStatus,
  },
  messageRepository: {
    updateToolResultBlock: mocks.updateToolResultBlock,
  },
}));

vi.mock('@aaa/observability', () => ({
  getLogContext: () => ({ correlationId: 'correlation-1' }),
  getLogger: () => ({
    info: vi.fn(),
  }),
}));

vi.mock('./tool-execution-queue.js', () => ({
  enqueueToolExecutionJob: mocks.enqueueToolExecutionJob,
}));

vi.mock('../ws/connections.js', () => ({
  broadcast: mocks.broadcast,
}));

const pendingApproval = {
  id: 'approval-1',
  userId: 'user-1',
  conversationId: 'conversation-1',
  toolExecutionId: 'tool-execution-1',
  status: 'pending',
};

const toolExecution = {
  id: 'tool-execution-1',
  toolName: 'github.get_file',
  input: { repo: 'owner/repo', path: 'README.md' },
  conversationId: 'conversation-1',
  messageId: 'message-1',
};

describe('ApprovalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findApprovalById.mockResolvedValue(pendingApproval);
    mocks.findToolExecutionById.mockResolvedValue(toolExecution);
  });

  it('rejects decisions for another user', async () => {
    mocks.findApprovalById.mockResolvedValue({ ...pendingApproval, userId: 'other-user' });

    await expect(
      new ApprovalService().decide('approval-1', 'user-1', 'approved'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it('rejects decisions for approvals that are no longer pending', async () => {
    mocks.findApprovalById.mockResolvedValue({ ...pendingApproval, status: 'approved' });

    await expect(
      new ApprovalService().decide('approval-1', 'user-1', 'approved'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_DECIDED',
    });
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it('marks approved tool executions pending and enqueues them', async () => {
    await new ApprovalService().decide('approval-1', 'user-1', 'approved');

    expect(mocks.decideApproval).toHaveBeenCalledWith('approval-1', 'approved');
    expect(mocks.updateToolExecutionStatus).toHaveBeenCalledWith('tool-execution-1', 'pending');
    expect(mocks.updateToolResultBlock).toHaveBeenCalledWith('message-1', 'tool-execution-1', {
      status: 'approved',
      detail: undefined,
      output: undefined,
    });
    expect(mocks.enqueueToolExecutionJob).toHaveBeenCalledWith({
      toolExecutionId: 'tool-execution-1',
      toolName: 'github.get_file',
      input: { repo: 'owner/repo', path: 'README.md' },
      conversationId: 'conversation-1',
      correlationId: 'correlation-1',
    });
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ type: 'approval.resolved', status: 'approved' }),
    );
  });

  it('marks rejected tool executions failed and broadcasts completion', async () => {
    await new ApprovalService().decide('approval-1', 'user-1', 'rejected');

    expect(mocks.updateToolExecutionStatus).toHaveBeenCalledWith('tool-execution-1', 'failed', {
      error: 'Rejected by user approval',
    });
    expect(mocks.enqueueToolExecutionJob).not.toHaveBeenCalled();
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        type: 'tool.done',
        status: 'failed',
        output: { error: 'Rejected by user approval' },
      }),
    );
    expect(mocks.broadcast).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ type: 'approval.resolved', status: 'rejected' }),
    );
  });
});
