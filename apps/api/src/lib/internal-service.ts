import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getLogger } from '@aaa/observability';
import { AppError } from './errors.js';

const INTERNAL_SERVICE_SECRET =
  process.env['INTERNAL_SERVICE_SECRET'] ?? 'dev-internal-service-secret';
const API_INSTANCE_ID =
  process.env['API_INSTANCE_ID'] ?? process.env['HOSTNAME'] ?? crypto.randomUUID();
const API_INTERNAL_BASE_URL =
  process.env['API_INTERNAL_BASE_URL'] ?? `http://127.0.0.1:${process.env['API_PORT'] ?? '3001'}`;

export function getInternalServiceSecret(): string {
  return INTERNAL_SERVICE_SECRET;
}

export function getApiInstanceId(): string {
  return API_INSTANCE_ID;
}

export function getApiInternalBaseUrl(): string {
  return API_INTERNAL_BASE_URL;
}

export function assertInternalServiceSecret(secret: string | null): void {
  if (!secret) {
    throw new AppError(401, 'Internal authentication required', 'INTERNAL_AUTH_REQUIRED');
  }

  const providedBuffer = Buffer.from(secret);
  const expectedBuffer = Buffer.from(INTERNAL_SERVICE_SECRET);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AppError(403, 'Internal authentication failed', 'INTERNAL_AUTH_INVALID');
  }
}

export async function authenticateInternalService(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers['x-internal-service-secret'];
  const provided =
    typeof header === 'string' ? header : Array.isArray(header) ? (header[0] ?? null) : null;
  const logger = getLogger({ component: 'auth' });

  try {
    assertInternalServiceSecret(provided);
  } catch (error) {
    logger.warn(
      {
        event: 'auth.failed',
        outcome: 'failure',
        reason: provided ? 'invalid_internal_secret' : 'missing_internal_secret',
        authKind: 'internal_service',
      },
      'Internal service authentication failed',
    );
    throw error;
  }
}
