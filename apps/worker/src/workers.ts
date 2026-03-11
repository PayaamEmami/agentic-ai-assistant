import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { handleIngestion } from './jobs/ingestion.js';
import { handleEmbedding } from './jobs/embedding.js';
import { handleConnectorSync } from './jobs/connector-sync.js';
import { handleToolExecution } from './jobs/tool-execution.js';
import { logger } from './lib/logger.js';

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

export function createWorkers(redisUrl: string): Worker[] {
  const connection = parseRedisUrl(redisUrl);

  const workers = [
    new Worker('ingestion', handleIngestion, { connection }),
    new Worker('embedding', handleEmbedding, { connection }),
    new Worker('connector-sync', handleConnectorSync, { connection }),
    new Worker('tool-execution', handleToolExecution, { connection }),
  ];

  for (const worker of workers) {
    worker.on('completed', (job) => {
      logger.info({ jobId: job.id, queue: job.queueName }, 'Job completed');
    });
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, queue: job?.queueName, error: err.message }, 'Job failed');
    });
  }

  return workers;
}
