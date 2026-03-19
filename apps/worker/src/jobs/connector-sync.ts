import type { Job } from 'bullmq';
import {
  connectorConfigRepository,
  documentRepository,
  sourceRepository,
  chunkRepository,
  embeddingRepository,
} from '@aaa/db';
import { createConnector, decryptConnectorCredentials } from '@aaa/connectors';
import { logger } from '../lib/logger.js';
import { enqueueIngestionJob } from '../lib/job-queues.js';

export interface ConnectorSyncJobData {
  connectorConfigId: string;
  userId: string;
  connectorKind: 'github' | 'google_docs';
}

export async function handleConnectorSync(job: Job<ConnectorSyncJobData>): Promise<void> {
  const { connectorConfigId, userId, connectorKind } = job.data;
  logger.info({ userId, connectorKind, connectorConfigId, jobId: job.id }, 'Processing connector sync job');

  const config = await connectorConfigRepository.findById(connectorConfigId);
  if (!config) {
    logger.warn({ connectorConfigId, jobId: job.id }, 'Connector config not found');
    return;
  }

  await connectorConfigRepository.updateSyncState(connectorConfigId, {
    lastSyncAt: new Date(),
    lastSyncStatus: 'running',
    lastError: null,
  });

  try {
    const connector = createConnector(connectorKind);
    await connector.initialize({
      kind: connectorKind,
      credentials: decryptConnectorCredentials(config.credentialsEncrypted),
      settings: config.settings,
    });

    const result = await connector.sync(config.lastSyncCursor ?? undefined);

    for (const item of result.items) {
      if (item.metadata.deleted === true) {
        const existingSource = await sourceRepository.findByExternalId(
          userId,
          connectorKind,
          item.externalId,
        );
        if (!existingSource) {
          continue;
        }

        await sourceRepository.update(existingSource.id, item.title, item.uri);
        const documents = await documentRepository.findBySourceId(existingSource.id);
        for (const document of documents) {
          const existingChunks = await chunkRepository.listByDocument(document.id);
          await embeddingRepository.deleteByChunkIds(existingChunks.map((chunk) => chunk.id));
          await chunkRepository.deleteByDocument(document.id);
          await documentRepository.updateDocument(
            document.id,
            item.title,
            null,
            item.mimeType,
          );
        }
        continue;
      }

      const source = await sourceRepository.upsertByExternalId(
        userId,
        item.sourceKind,
        connectorKind,
        item.externalId,
        item.title,
        item.uri,
      );
      const document = await documentRepository.upsertBySourceId(
        userId,
        source.id,
        item.title,
        null,
        item.mimeType,
      );

      await enqueueIngestionJob({
        connectorConfigId,
        documentId: document.id,
        sourceId: source.id,
        userId,
        externalId: item.externalId,
      });
    }

    await connectorConfigRepository.updateSyncState(connectorConfigId, {
      lastSyncCursor: result.nextCursor,
      lastSyncAt: new Date(),
      lastSyncStatus: result.errors.length > 0 ? 'failed' : 'completed',
      lastError: result.errors.length > 0 ? result.errors.map((entry) => `${entry.externalId}: ${entry.error}`).join('; ') : null,
    });
    await connectorConfigRepository.updateStatus(
      connectorConfigId,
      'connected',
      result.errors.length > 0
        ? result.errors.map((entry) => `${entry.externalId}: ${entry.error}`).join('; ')
        : null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await connectorConfigRepository.updateStatus(connectorConfigId, 'failed', message);
    await connectorConfigRepository.updateSyncState(connectorConfigId, {
      lastSyncAt: new Date(),
      lastSyncStatus: 'failed',
      lastError: message,
    });
    throw error;
  }
}
