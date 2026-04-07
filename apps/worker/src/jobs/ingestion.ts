import type { Job } from 'bullmq';
import {
  chunkRepository,
  appCapabilityConfigRepository,
  documentRepository,
  embeddingRepository,
  sourceRepository,
} from '@aaa/db';
import { createKnowledgeSource, decryptCredentials } from '@aaa/knowledge-sources';
import { SimpleChunkingService } from '@aaa/retrieval';
import { logger } from '../lib/logger.js';
import { enqueueEmbeddingJob } from '../lib/job-queues.js';

export interface IngestionJobData {
  appCapabilityConfigId: string;
  appKind: 'github' | 'google';
  documentId: string;
  sourceId: string;
  userId: string;
  externalId: string;
  correlationId: string;
}

export async function handleIngestion(job: Job<IngestionJobData>): Promise<void> {
  const { appCapabilityConfigId, appKind, documentId, sourceId, externalId, correlationId } =
    job.data;
  logger.info(
    {
      event: 'ingestion.started',
      outcome: 'start',
      documentId,
      sourceId,
      externalId,
      jobId: job.id,
      correlationId,
    },
    'Processing ingestion job',
  );

  const config = await appCapabilityConfigRepository.findById(appCapabilityConfigId);
  if (!config) {
    logger.warn(
      {
        event: 'ingestion.skipped',
        outcome: 'failure',
        appCapabilityConfigId,
        jobId: job.id,
        correlationId,
      },
      'App capability config not found for ingestion job',
    );
    return;
  }

  const knowledgeSource = createKnowledgeSource(appKind);
  await knowledgeSource.initialize({
    kind: appKind,
    credentials: decryptCredentials(config.encryptedCredentials),
    settings: config.settings,
  });

  const item = await knowledgeSource.read(externalId);
  if (!item) {
    logger.warn(
      {
        event: 'ingestion.skipped',
        outcome: 'failure',
        externalId,
        appCapabilityConfigId,
        jobId: job.id,
        correlationId,
      },
      'Knowledge source item could not be read',
    );
    return;
  }

  await sourceRepository.update(sourceId, item.title, item.uri);
  await documentRepository.updateDocument(documentId, item.title, item.content, item.mimeType);

  const existingChunks = await chunkRepository.listByDocument(documentId);
  await embeddingRepository.deleteByChunkIds(existingChunks.map((chunk) => chunk.id));
  await chunkRepository.deleteByDocument(documentId);

  const content = item.content?.trim() ?? '';
  if (!content) {
    logger.info(
      {
        event: 'ingestion.completed',
        outcome: 'success',
        documentId,
        correlationId,
        chunkCount: 0,
      },
      'Ingestion completed without chunking',
    );
    return;
  }

  const chunkingService = new SimpleChunkingService();
  const chunks = await chunkingService.chunk({
    id: documentId,
    sourceId,
    title: item.title,
    content,
    mimeType: item.mimeType,
    metadata: {
      appKind: config.appKind,
      externalId: item.externalId,
      uri: item.uri,
      ...item.metadata,
    },
  });

  await Promise.all(
    chunks.map((chunk) =>
      chunkRepository.createWithId(
        chunk.id,
        chunk.documentId,
        chunk.content,
        chunk.index,
        chunk.tokenCount,
        chunk.metadata,
      ),
    ),
  );

  if (chunks.length > 0) {
    await enqueueEmbeddingJob({
      chunkIds: chunks.map((chunk) => chunk.id),
      model: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
      correlationId,
    });
  }

  logger.info(
    {
      event: 'ingestion.completed',
      outcome: 'success',
      documentId,
      sourceId,
      correlationId,
      chunkCount: chunks.length,
    },
    'Ingestion completed',
  );
}
