import type { FastifyInstance } from 'fastify';
import { ClientTelemetryRequest } from '@aaa/shared';
import { clientTelemetryAccepted, clientWebVitals } from '../lib/telemetry.js';

export async function clientTelemetryRoutes(app: FastifyInstance) {
  app.post('/client-telemetry', async (request, reply) => {
    const parsed = ClientTelemetryRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    for (const metric of parsed.data.metrics) {
      clientTelemetryAccepted.inc({ metric_name: metric.name });
      clientWebVitals.observe(
        {
          metric_name: metric.name,
          rating: metric.rating ?? 'unknown',
        },
        metric.value,
      );
    }

    return reply.status(202).send({ accepted: true });
  });
}
