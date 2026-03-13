import type { FastifyInstance } from 'fastify';
import { userRepository } from '@aaa/db';
import { AppError } from '../lib/errors.js';
import { signAuthToken } from '../lib/jwt.js';
import { authenticate } from '../middleware/auth.js';

interface DevLoginBody {
  email?: string;
  displayName?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: DevLoginBody }>('/auth/dev-login', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(404, 'Not found', 'NOT_FOUND');
    }

    const email = normalizeEmail(request.body?.email ?? 'dev@localhost');
    const displayName = request.body?.displayName?.trim() || 'Dev User';

    let user = await userRepository.findByEmail(email);
    if (!user) {
      user = await userRepository.create(email, displayName);
    }

    const token = signAuthToken(user.id, user.email);
    return reply.status(200).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    return reply.status(200).send({ user: request.user });
  });
}
