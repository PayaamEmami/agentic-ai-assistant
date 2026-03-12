import { approvalRepository, toolExecutionRepository } from '@aaa/db';
import type { ApprovalResolvedEvent } from '@aaa/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { broadcast } from '../ws/connections.js';

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

    await approvalRepository.decide(approvalId, status);

    if (status === 'approved') {
      await toolExecutionRepository.updateStatus(approval.toolExecutionId, 'running');
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
