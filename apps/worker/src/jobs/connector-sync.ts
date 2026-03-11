import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';

export interface ConnectorSyncJobData {
  userId: string;
  connectorKind: string;
  cursor?: string;
}

export async function handleConnectorSync(job: Job<ConnectorSyncJobData>): Promise<void> {
  const { userId, connectorKind, cursor } = job.data;
  logger.info({ userId, connectorKind, cursor, jobId: job.id }, 'Processing connector sync job');

  // TODO: implement connector sync:
  // 1. Load connector config and credentials
  // 2. Initialize connector
  // 3. Sync items incrementally
  // 4. Enqueue ingestion jobs for new/updated items
  // 5. Store next cursor for incremental sync
}
