import http from 'node:http';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { pingDatabase } from '@aaa/db';
import {
  createCounter,
  createGauge,
  createHistogram,
  getMetricsContentType,
  initializeMetrics,
  initializeTracing,
  renderMetrics,
} from '@aaa/observability';

const instanceId = process.env['HOSTNAME'] ?? randomUUID();

export const workerJobCounter = createCounter({
  name: 'aaa_worker_jobs_total',
  help: 'Worker jobs grouped by queue and outcome',
  labelNames: ['queue', 'outcome'] as const,
}) as ReturnType<typeof createCounter>;

export const workerJobDurationMs = createHistogram({
  name: 'aaa_worker_job_duration_ms',
  help: 'Worker job duration in milliseconds grouped by queue and outcome',
  labelNames: ['queue', 'outcome'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
}) as ReturnType<typeof createHistogram>;

export const workerQueueDepth = createGauge({
  name: 'aaa_worker_queue_depth',
  help: 'Worker queue depth grouped by queue and state',
  labelNames: ['queue', 'state'] as const,
}) as ReturnType<typeof createGauge>;

export const workerHeartbeat = createGauge({
  name: 'aaa_worker_heartbeat_timestamp_seconds',
  help: 'Unix timestamp of the latest worker heartbeat',
}) as ReturnType<typeof createGauge>;

export const workerReadinessState = createGauge({
  name: 'aaa_worker_readiness_state',
  help: 'Worker readiness state where 1 means ready',
  labelNames: ['dependency'] as const,
}) as ReturnType<typeof createGauge>;

const QUEUE_NAMES = ['app-sync', 'ingestion', 'embedding', 'tool-execution'] as const;

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

export async function initializeWorkerTelemetry(): Promise<void> {
  initializeMetrics('worker', instanceId);
  await initializeTracing({
    service: 'worker',
    instanceId,
  });
}

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

async function snapshotQueues(redisUrl: string): Promise<void> {
  for (const queueName of QUEUE_NAMES) {
    const queue = new Queue(queueName, {
      connection: parseRedisUrl(redisUrl),
    });

    try {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );

      workerQueueDepth.set({ queue: queueName, state: 'waiting' }, counts.waiting ?? 0);
      workerQueueDepth.set({ queue: queueName, state: 'active' }, counts.active ?? 0);
      workerQueueDepth.set({ queue: queueName, state: 'completed' }, counts.completed ?? 0);
      workerQueueDepth.set({ queue: queueName, state: 'failed' }, counts.failed ?? 0);
      workerQueueDepth.set({ queue: queueName, state: 'delayed' }, counts.delayed ?? 0);
    } finally {
      await queue.close();
    }
  }
}

export async function startWorkerObservabilityServer(
  redisUrl: string,
): Promise<{ server: http.Server; stopPolling: () => void }> {
  const host = process.env['WORKER_OBSERVABILITY_HOST'] ?? '0.0.0.0';
  const port = parseInt(process.env['WORKER_OBSERVABILITY_PORT'] ?? '9464', 10);

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }

    if (req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.url === '/health/ready') {
      const checks = {
        database: false,
        redis: false,
      };

      try {
        await pingDatabase();
        checks.database = true;
        workerReadinessState.set({ dependency: 'database' }, 1);
      } catch {
        workerReadinessState.set({ dependency: 'database' }, 0);
      }

      try {
        await pingRedis(redisUrl);
        checks.redis = true;
        workerReadinessState.set({ dependency: 'redis' }, 1);
      } catch {
        workerReadinessState.set({ dependency: 'redis' }, 0);
      }

      const ready = Object.values(checks).every(Boolean);
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ok' : 'degraded', checks }));
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': getMetricsContentType() });
      res.end(await renderMetrics());
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  const interval = setInterval(() => {
    workerHeartbeat.setToCurrentTime();
    void snapshotQueues(redisUrl);
  }, 10_000);
  interval.unref();
  workerHeartbeat.setToCurrentTime();
  void snapshotQueues(redisUrl);

  return {
    server,
    stopPolling: () => clearInterval(interval),
  };
}
