import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { getLogger, serializeError } from '@aaa/observability';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const componentLogger = getLogger({
    component: 'http',
    route: request.routeOptions.url,
    method: request.method,
  });

  if (error instanceof AppError) {
    const level = error.statusCode >= 500 ? 'error' : 'warn';
    componentLogger[level](
      {
        event: 'http.request.failed',
        outcome: 'failure',
        statusCode: error.statusCode,
        error: serializeError(error),
      },
      'Request failed with application error',
    );
    return reply.status(error.statusCode).send({
      error: { code: error.code ?? 'APP_ERROR', message: error.message },
    });
  }

  componentLogger.error(
    {
      event: 'http.request.failed',
      outcome: 'failure',
      statusCode: 500,
      error: serializeError(error),
    },
    'Unhandled error',
  );
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}
