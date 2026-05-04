import Redis from 'ioredis';
import type { WorkerConfig } from '@aaa/config';
import { appCapabilityConfigRepository } from '@aaa/db';
import { logger } from './logger.js';
import { enqueueAppSyncJob } from './job-queues.js';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const SCHEDULER_LOCK_KEY = 'aaa:app-sync-scheduler';
const SCHEDULER_LOCK_TTL_SECONDS = 55 * 60;

async function scheduleDueAppSyncs(config: WorkerConfig): Promise<void> {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  try {
    await redis.connect();
    const lock = await redis.set(SCHEDULER_LOCK_KEY, '1', 'EX', SCHEDULER_LOCK_TTL_SECONDS, 'NX');
    if (lock !== 'OK') {
      logger.info(
        {
          event: 'app.sync_schedule.skipped',
          outcome: 'success',
          reason: 'lock_not_acquired',
        },
        'Skipping app sync scheduling on this replica',
      );
      return;
    }

    const configs = await appCapabilityConfigRepository.listConnected();
    const now = Date.now();

    for (const config of configs) {
      const lastSyncTime = config.lastSyncAt?.getTime() ?? 0;
      if (now - lastSyncTime < REFRESH_INTERVAL_MS) {
        continue;
      }

      if (config.capability !== 'knowledge') {
        continue;
      }

      await enqueueAppSyncJob({
        appCapabilityConfigId: config.id,
        appKind: config.appKind as 'github' | 'google',
        capability: 'knowledge',
        userId: config.userId,
        correlationId: `scheduled-${config.id}-${now}`,
      });
    }
  } finally {
    redis.disconnect();
  }
}

export function startAppSyncScheduler(config: WorkerConfig): NodeJS.Timeout {
  void scheduleDueAppSyncs(config).catch((error) => {
    logger.error(
      {
        event: 'app.sync_schedule.failed',
        outcome: 'failure',
        error,
      },
      'Initial app sync scheduling failed',
    );
  });

  return setInterval(() => {
    void scheduleDueAppSyncs(config).catch((error) => {
      logger.error(
        {
          event: 'app.sync_schedule.failed',
          outcome: 'failure',
          error,
        },
        'App sync scheduling failed',
      );
    });
  }, REFRESH_INTERVAL_MS);
}
