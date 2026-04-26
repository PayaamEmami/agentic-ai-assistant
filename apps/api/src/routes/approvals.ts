import type { FastifyInstance } from 'fastify';
import { ApprovalDecisionRequest } from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { ApprovalService } from '../services/approval-service.js';

interface ApprovalRouteOptions {
  approvalService?: ApprovalService;
}

export async function approvalRoutes(app: FastifyInstance, options: ApprovalRouteOptions = {}) {
  const approvalService = options.approvalService ?? new ApprovalService();

  app.addHook('preHandler', authenticate);

  app.get('/approvals', async (request, reply) => {
    const userId = request.user!.id;
    const approvals = await approvalService.listPending(userId);
    return reply.status(200).send({ approvals });
  });

  app.post<{
    Params: { id: string };
  }>('/approvals/:id/decide', async (request, reply) => {
    const parsed = ApprovalDecisionRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const userId = request.user!.id;
    await approvalService.decide(request.params.id, userId, parsed.data.status);
    return reply.status(200).send({ ok: true });
  });
}
