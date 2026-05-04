import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildApiInstanceId, buildApiInternalBaseUrl, loadInternalServiceEnv } from '@aaa/config';
import { getLogger } from '@aaa/observability';
import { AppError } from './errors.js';

const env = loadInternalServiceEnv();
const INTERNAL_SERVICE_SECRET = env.INTERNAL_SERVICE_SECRET;
const API_INSTANCE_ID = buildApiInstanceId(env);
const API_INTERNAL_BASE_URL = buildApiInternalBaseUrl(env);

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
    !timingSafeEqual(providedBuffer, expectedBuffer)
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
