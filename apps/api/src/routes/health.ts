import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { pingDatabase } from '@aaa/db';
import { getMetricsContentType, renderMetrics } from '@aaa/observability';
import { readinessState } from '../lib/telemetry.js';

const startTime = Date.now();

async function pingRedis(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      status: 'ok',
      version: '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  app.get('/health/live', async () => {
    return {
      status: 'ok',
      version: '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  app.get('/health/ready', async (_request, reply) => {
    const checks = {
      database: false,
      redis: false,
    };

    try {
      await pingDatabase();
      checks.database = true;
      readinessState.set({ dependency: 'database' }, 1);
    } catch {
      readinessState.set({ dependency: 'database' }, 0);
    }

    try {
      await pingRedis(app.config.redisUrl);
      checks.redis = true;
      readinessState.set({ dependency: 'redis' }, 1);
    } catch {
      readinessState.set({ dependency: 'redis' }, 0);
    }

    const ready = Object.values(checks).every(Boolean);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'degraded',
      version: '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks,
    });
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', getMetricsContentType());
    return renderMetrics();
  });
}
