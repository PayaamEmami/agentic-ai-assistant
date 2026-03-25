import type { FastifyInstance } from 'fastify';
import { addLogContext, getLogger, sanitizeForLogs } from '@aaa/observability';
import { ClientLogRequest } from '@aaa/shared';
import { extractBearerToken, authenticateToken } from '../middleware/auth.js';

export async function clientLogRoutes(app: FastifyInstance) {
  app.post('/client-logs', async (request, reply) => {
    const parsed = ClientLogRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const token = extractBearerToken(request.headers.authorization);
    if (token) {
      try {
        const user = await authenticateToken(token);
        addLogContext({ userId: user.id });
      } catch {
        // Ignore invalid auth for client log ingestion so browser errors still reach the server.
      }
    }

    const logger = getLogger({ component: 'client-log-ingest' });
    for (const entry of parsed.data.logs) {
      const level = entry.level === 'error' ? 'error' : 'warn';
      logger[level](
        {
          event: entry.event,
          outcome: 'failure',
          component: entry.component,
          requestId: entry.requestId,
          correlationId: entry.correlationId ?? entry.voiceSessionId,
          conversationId: entry.conversationId,
          voiceSessionId: entry.voiceSessionId,
          clientUrl: entry.url,
          userAgent: entry.userAgent,
          clientTimestamp: entry.timestamp,
          context: sanitizeForLogs(entry.context),
        },
        entry.message,
      );
    }

    return reply.status(202).send({ accepted: true });
  });
}
