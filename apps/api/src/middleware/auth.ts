import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool, userRepository } from '@aaa/db';
import { AppError } from '../lib/errors.js';
import { verifyAuthToken } from '../lib/jwt.js';

export interface AuthUser {
  id: string;
  email: string;
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
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  if (!token) {
    throw new AppError(401, 'Missing bearer token', 'AUTH_REQUIRED');
  }

  const claims = verifyAuthToken(token);
  if (!claims) {
    throw new AppError(401, 'Invalid or expired token', 'AUTH_INVALID');
  }

  getPool();
  const user = await userRepository.findById(claims.sub);
  if (!user) {
    throw new AppError(401, 'User not found for token subject', 'AUTH_INVALID_USER');
  }

  request.user = { id: user.id, email: user.email };
}
