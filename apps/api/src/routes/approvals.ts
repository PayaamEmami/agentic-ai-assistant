import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { ApprovalService } from '../services/approval-service.js';

export async function approvalRoutes(app: FastifyInstance) {
  const approvalService = new ApprovalService();

  app.addHook('preHandler', authenticate);

  app.get('/approvals', async (request, reply) => {
    const userId = request.user!.id;
    const approvals = await approvalService.listPending(userId);
    return reply.status(200).send({ approvals });
  });

  app.post<{
    Params: { id: string };
    Body: { status: 'approved' | 'rejected' };
  }>('/approvals/:id/decide', async (request, reply) => {
    const userId = request.user!.id;
    await approvalService.decide(
      request.params.id,
      userId,
      request.body.status,
    );
    return reply.status(200).send({ ok: true });
  });
}
