import type { Job } from 'bullmq';
import {
  appCapabilityConfigRepository,
  appSyncRunRepository,
  documentRepository,
  sourceRepository,
  chunkRepository,
  embeddingRepository,
} from '@aaa/db';
import { createKnowledgeSource, decryptCredentials } from '@aaa/knowledge-sources';
import { logger } from '../lib/logger.js';
import { enqueueIngestionJob } from '../lib/job-queues.js';

export interface AppSyncJobData {
  appCapabilityConfigId: string;
  userId: string;
  appKind: 'github' | 'google';
  capability: 'knowledge';
  correlationId: string;
}

export async function handleAppSync(job: Job<AppSyncJobData>): Promise<void> {
  const { appCapabilityConfigId, userId, appKind, capability, correlationId } = job.data;
  logger.info(
    {
      event: 'app.sync.started',
      outcome: 'start',
      userId,
      appKind,
      appCapability: capability,
      appCapabilityConfigId,
      jobId: job.id,
      correlationId,
    },
    'Processing app sync job',
  );

  const config = await appCapabilityConfigRepository.findById(appCapabilityConfigId);
  if (!config) {
    logger.warn(
      {
        event: 'app.sync.skipped',
        outcome: 'failure',
        appCapabilityConfigId,
        jobId: job.id,
        correlationId,
      },
      'App capability config not found',
    );
    return;
  }

  const syncRun = await appSyncRunRepository.create(
    userId,
    appKind,
    capability,
    appCapabilityConfigId,
    'manual',
  );

  await appCapabilityConfigRepository.updateSyncState(appCapabilityConfigId, {
    lastSyncAt: new Date(),
    lastSyncStatus: 'running',
    lastError: null,
  });

  try {
    const knowledgeSource = createKnowledgeSource(appKind);
    await knowledgeSource.initialize({
      kind: appKind,
      credentials: decryptCredentials(config.encryptedCredentials),
      settings: config.settings,
    });

    const result = await knowledgeSource.sync(config.lastSyncCursor ?? undefined);
    const itemsDeleted = result.items.filter((item) => item.metadata['deleted'] === true).length;
    const itemsQueued = result.items.length - itemsDeleted;
    const errorSummary =
      result.errors.length > 0
        ? result.errors.map((entry) => `${entry.externalId}: ${entry.error}`).join('; ')
        : null;

    for (const item of result.items) {
      if (item.metadata['deleted'] === true) {
        const existingSource = await sourceRepository.findByExternalId(
          userId,
          appKind,
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
          await documentRepository.updateDocument(document.id, item.title, null, item.mimeType);
        }
        continue;
      }

      const source = await sourceRepository.upsertByExternalId(
        userId,
        item.sourceKind,
        appKind,
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
        appCapabilityConfigId,
        appKind,
        documentId: document.id,
        sourceId: source.id,
        userId,
        externalId: item.externalId,
        correlationId,
      });
    }

    await appCapabilityConfigRepository.updateSyncState(appCapabilityConfigId, {
      lastSyncCursor: result.nextCursor,
      lastSyncAt: new Date(),
      lastSyncStatus: result.errors.length > 0 ? 'failed' : 'completed',
      lastError: errorSummary,
    });
    await appCapabilityConfigRepository.updateStatus(
      appCapabilityConfigId,
      'connected',
      errorSummary,
    );
    await appSyncRunRepository.complete(syncRun.id, {
      status: result.errors.length > 0 ? 'failed' : 'completed',
      itemsDiscovered: result.items.length,
      itemsQueued,
      itemsDeleted,
      errorCount: result.errors.length,
      errorSummary,
    });
    logger.info(
      {
        event: 'app.sync.completed',
        outcome: result.errors.length > 0 ? 'failure' : 'success',
        appCapabilityConfigId,
        appKind,
        appCapability: capability,
        correlationId,
        itemsDiscovered: result.items.length,
        itemsQueued,
        itemsDeleted,
        errorCount: result.errors.length,
      },
      'App sync finished',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appCapabilityConfigRepository.updateStatus(appCapabilityConfigId, 'failed', message);
    await appCapabilityConfigRepository.updateSyncState(appCapabilityConfigId, {
      lastSyncAt: new Date(),
      lastSyncStatus: 'failed',
      lastError: message,
    });
    await appSyncRunRepository.complete(syncRun.id, {
      status: 'failed',
      itemsDiscovered: 0,
      itemsQueued: 0,
      itemsDeleted: 0,
      errorCount: 1,
      errorSummary: message,
    });
    logger.error(
      {
        event: 'app.sync.failed',
        outcome: 'failure',
        appCapabilityConfigId,
        appKind,
        appCapability: capability,
        correlationId,
        error,
      },
      'App sync failed',
    );
    throw error;
  }
}
