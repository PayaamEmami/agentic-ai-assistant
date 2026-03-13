import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool, userRepository } from '@aaa/db';
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

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    throw new AppError(401, 'Missing bearer token', 'AUTH_REQUIRED');
  }

  request.user = await authenticateToken(token);
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;
}

export async function authenticateToken(token: string): Promise<AuthUser> {
  const claims = verifyAuthToken(token);
  if (!claims) {
    throw new AppError(401, 'Invalid or expired token', 'AUTH_INVALID');
  }

  getPool();
  const user = await userRepository.findById(claims.sub);
  if (!user) {
    throw new AppError(401, 'User not found for token subject', 'AUTH_INVALID_USER');
  }

  return { id: user.id, email: user.email, displayName: user.displayName };
}
