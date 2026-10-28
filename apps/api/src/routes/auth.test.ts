import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { userRepository } from '@aaa/db';
import type { AppConfig } from '../config.js';
import { errorHandler } from '../lib/errors.js';
import { authRoutes } from './auth.js';

vi.mock('@aaa/db', () => ({
  userRepository: {
    findByEmail: vi.fn(),
    create: vi.fn(),
  },
  getPool: vi.fn(),
}));

const users = vi.mocked(userRepository);

const DEV_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'dev@localhost',
  displayName: 'Dev User',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function createApp(nodeEnv: AppConfig['nodeEnv']) {
  const app = Fastify({ logger: false });
  app.decorate('config', { nodeEnv } as AppConfig);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/api' });
  return app;
}

describe('POST /api/auth/dev-login', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is hidden in production', async () => {
    const app = await createApp('production');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { email: 'someone@example.com' },
    });

    expect(response.statusCode).toBe(404);
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('only creates or enters dev@localhost', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue(DEV_USER);
    const app = await createApp('development');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { email: 'someone@example.com', displayName: 'Someone' },
    });

    expect(response.statusCode).toBe(200);
    expect(users.findByEmail).toHaveBeenCalledWith('dev@localhost');
    expect(users.create).toHaveBeenCalledWith('dev@localhost', 'Dev User');
    expect(response.json()).toMatchObject({
      user: { email: 'dev@localhost', displayName: 'Dev User' },
    });
    await app.close();
  });

  it('does not create a second user when dev@localhost already exists', async () => {
    users.findByEmail.mockResolvedValue(DEV_USER);
    const app = await createApp('development');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { email: 'someone@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(users.create).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({ user: { email: 'dev@localhost' } });
    await app.close();
  });
});
