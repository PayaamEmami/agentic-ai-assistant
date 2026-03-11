import { logger } from '../lib/logger.js';

export class ApprovalService {
  async listPending(_userId: string) {
    // TODO: query pending approvals from database
    return [];
  }

  async decide(
    approvalId: string,
    userId: string,
    status: 'approved' | 'rejected',
  ) {
    // TODO: update approval status in database
    // TODO: if approved, resume tool execution
    // TODO: if rejected, notify agent orchestrator
    logger.info({ approvalId, userId, status }, 'Approval decision');
  }
}
