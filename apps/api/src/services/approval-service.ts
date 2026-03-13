import { approvalRepository, messageRepository, toolExecutionRepository } from '@aaa/db';
import type { ApprovalResolvedEvent, ToolDoneEvent } from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { enqueueToolExecutionJob } from './tool-execution-queue.js';
import { broadcast } from '../ws/connections.js';

function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export class ApprovalService {
  async listPending(userId: string) {
    return approvalRepository.listPendingByUser(userId);
  }

  async decide(
    approvalId: string,
    userId: string,
    status: 'approved' | 'rejected',
  ) {
    const approval = await approvalRepository.findById(approvalId);
    if (!approval) {
      throw new AppError(404, 'Approval not found', 'APPROVAL_NOT_FOUND');
    }

    if (approval.userId !== userId) {
      throw new AppError(403, 'Approval does not belong to user', 'FORBIDDEN');
    }
    if (approval.status !== 'pending') {
      throw new AppError(409, 'Approval has already been decided', 'ALREADY_DECIDED');
    }

    await approvalRepository.decide(approvalId, status);

    const toolExecution = await toolExecutionRepository.findById(approval.toolExecutionId);
    if (!toolExecution) {
      throw new AppError(404, 'Tool execution not found', 'TOOL_EXECUTION_NOT_FOUND');
    }

    if (status === 'approved') {
      await enqueueToolExecutionJob({
        toolExecutionId: toolExecution.id,
        toolName: toolExecution.toolName,
        input: toRecord(toolExecution.input),
        conversationId: toolExecution.conversationId,
      });
    } else {
      const rejectionOutput = { error: 'Rejected by user approval' };
      await toolExecutionRepository.updateStatus(
        approval.toolExecutionId,
        'failed',
        rejectionOutput,
      );
      await messageRepository.create(approval.conversationId, 'tool', [
        {
          type: 'tool_result',
          toolExecutionId: toolExecution.id,
          toolName: toolExecution.toolName,
          status: 'failed',
          output: rejectionOutput,
        },
      ]);

      const doneEvent: ToolDoneEvent = {
        type: 'tool.done',
        conversationId: approval.conversationId,
        toolExecutionId: toolExecution.id,
        toolName: toolExecution.toolName,
        output: rejectionOutput,
        status: 'failed',
      };
      broadcast(approval.conversationId, doneEvent);
    }

    const event: ApprovalResolvedEvent = {
      type: 'approval.resolved',
      conversationId: approval.conversationId,
      approvalId: approval.id,
      status,
    };
    broadcast(approval.conversationId, event);

    logger.info({ approvalId, userId, status }, 'Approval decision');
  }
}
