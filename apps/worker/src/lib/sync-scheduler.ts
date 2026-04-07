import { appCapabilityConfigRepository } from '@aaa/db';
import { logger } from './logger.js';
import { enqueueAppSyncJob } from './job-queues.js';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

async function scheduleDueAppSyncs(): Promise<void> {
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
}

export function startAppSyncScheduler(): NodeJS.Timeout {
  void scheduleDueAppSyncs().catch((error) => {
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
    void scheduleDueAppSyncs().catch((error) => {
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
