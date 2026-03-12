import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool, userRepository } from '@aaa/db';
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
  const principal = request.headers['x-user-id'] as string | undefined;
  if (!principal) {
    throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  getPool();

  const normalizedPrincipal = principal.trim().toLowerCase();
  const safePrincipal = normalizedPrincipal.replace(/[^a-z0-9._-]/g, '-').slice(0, 64);
  const email = `${safePrincipal || 'dev-user'}@localhost`;

  const user =
    (await userRepository.findByEmail(email)) ??
    (await userRepository.create(email, safePrincipal || 'Dev User'));

  request.user = { id: user.id, email: user.email };
}
