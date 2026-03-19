import { connectorConfigRepository } from '@aaa/db';
import { logger } from './logger.js';
import { enqueueConnectorSyncJob } from './job-queues.js';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

async function scheduleDueConnectorSyncs(): Promise<void> {
  const configs = await connectorConfigRepository.listConnected();
  const now = Date.now();

  for (const config of configs) {
    const lastSyncTime = config.lastSyncAt?.getTime() ?? 0;
    if (now - lastSyncTime < REFRESH_INTERVAL_MS) {
      continue;
    }

    if (config.kind !== 'github' && config.kind !== 'google_docs') {
      continue;
    }

    await enqueueConnectorSyncJob({
      connectorConfigId: config.id,
      connectorKind: config.kind,
      userId: config.userId,
    });
  }
}

export function startConnectorSyncScheduler(): NodeJS.Timeout {
  void scheduleDueConnectorSyncs().catch((error) => {
    logger.error({ error }, 'Initial connector sync scheduling failed');
  });

  return setInterval(() => {
    void scheduleDueConnectorSyncs().catch((error) => {
      logger.error({ error }, 'Connector sync scheduling failed');
    });
  }, REFRESH_INTERVAL_MS);
}
