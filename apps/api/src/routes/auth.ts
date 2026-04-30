import type { FastifyInstance } from 'fastify';
import { AuthCredentialsRequest } from '@aaa/shared';
import { userRepository } from '@aaa/db';
import { signAuthToken } from '../lib/jwt.js';
import { verifyPassword } from '../lib/password.js';
import { AppError } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';

interface DevLoginBody {
  email?: string;
  displayName?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function authRoutes(app: FastifyInstance) {
  // Account creation is intentionally disabled. To re-enable, restore the
  // `RegisterRequest` import above and uncomment the handler below.
  // app.post('/auth/register', async (request, reply) => {
  //   const parsed = RegisterRequest.safeParse(request.body);
  //   if (!parsed.success) {
  //     return reply.status(400).send({
  //       error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
  //     });
  //   }
  //
  //   const email = normalizeEmail(parsed.data.email);
  //   const existing = await userRepository.findAuthByEmail(email);
  //   if (existing) {
  //     throw new AppError(409, 'An account already exists for this email', 'AUTH_EMAIL_EXISTS');
  //   }
  //
  //   const passwordHash = await hashPassword(parsed.data.password);
  //   const user = await userRepository.create(email, parsed.data.displayName.trim(), passwordHash);
  //   const token = signAuthToken(user.id, user.email);
  //
  //   return reply.status(201).send({
  //     token,
  //     user: {
  //       id: user.id,
  //       email: user.email,
  //       displayName: user.displayName,
  //     },
  //   });
  // });

  app.post('/auth/login', async (request, reply) => {
    const parsed = AuthCredentialsRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const email = normalizeEmail(parsed.data.email);
    const user = await userRepository.findAuthByEmail(email);
    const isValid = await verifyPassword(parsed.data.password, user?.passwordHash);
    if (!user || !isValid) {
      throw new AppError(401, 'Invalid email or password', 'AUTH_INVALID_CREDENTIALS');
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
    return reply.status(200).send({
      user: {
        id: request.user!.id,
        email: request.user!.email,
        displayName: request.user!.displayName,
      },
    });
  });
}
