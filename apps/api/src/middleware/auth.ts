import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../lib/errors.js';

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
  // TODO: implement real authentication (JWT, session, etc.)
  const userId = request.headers['x-user-id'] as string | undefined;
  if (!userId) {
    throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  }
  request.user = { id: userId, email: 'dev@localhost' };
}
