import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool, userRepository } from '@aaa/db';
import { addLogContext, getLogger } from '@aaa/observability';
import { AppError } from '../lib/errors.js';
import { verifyAuthToken } from '../lib/jwt.js';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);
  const logger = getLogger({ component: 'auth' });

  if (!token) {
    logger.warn(
      {
        event: 'auth.failed',
        outcome: 'failure',
        reason: 'missing_bearer_token',
      },
      'Authentication failed',
    );
    throw new AppError(401, 'Missing bearer token', 'AUTH_REQUIRED');
  }

  request.user = await authenticateToken(token);
  addLogContext({ userId: request.user.id });
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
}

export async function authenticateToken(token: string): Promise<AuthUser> {
  const claims = verifyAuthToken(token);
  const logger = getLogger({ component: 'auth' });
  if (!claims) {
    logger.warn(
      {
        event: 'auth.failed',
        outcome: 'failure',
        reason: 'invalid_token',
      },
      'Authentication failed',
    );
    throw new AppError(401, 'Invalid or expired token', 'AUTH_INVALID');
  }

  getPool();
  const user = await userRepository.findById(claims.sub);
  if (!user) {
    logger.warn(
      {
        event: 'auth.failed',
        outcome: 'failure',
        reason: 'unknown_user',
      },
      'Authentication failed',
    );
    throw new AppError(401, 'User not found for token subject', 'AUTH_INVALID_USER');
  }

  logger.debug(
    {
      event: 'auth.succeeded',
      outcome: 'success',
      userId: user.id,
    },
    'Authentication succeeded',
  );
  return { id: user.id, email: user.email, displayName: user.displayName };
}
