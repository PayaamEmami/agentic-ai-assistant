import type { Job } from 'bullmq';
import {
  chunkRepository,
  connectorConfigRepository,
  documentRepository,
  embeddingRepository,
  sourceRepository,
} from '@aaa/db';
import { createConnector, decryptConnectorCredentials } from '@aaa/connectors';
import { SimpleChunkingService } from '@aaa/retrieval';
import { logger } from '../lib/logger.js';
import { enqueueEmbeddingJob } from '../lib/job-queues.js';

export interface IngestionJobData {
  connectorConfigId: string;
  documentId: string;
  sourceId: string;
  userId: string;
  externalId: string;
}

export async function handleIngestion(job: Job<IngestionJobData>): Promise<void> {
  const { connectorConfigId, documentId, sourceId, externalId } = job.data;
  logger.info({ documentId, sourceId, externalId, jobId: job.id }, 'Processing ingestion job');

  const config = await connectorConfigRepository.findById(connectorConfigId);
  if (!config) {
    logger.warn({ connectorConfigId, jobId: job.id }, 'Connector config not found for ingestion job');
    return;
  }

  const connector = createConnector(config.kind as 'github' | 'google_docs');
  await connector.initialize({
    kind: config.kind as 'github' | 'google_docs',
    credentials: decryptConnectorCredentials(config.credentialsEncrypted),
    settings: config.settings,
  });

  const item = await connector.read(externalId);
  if (!item) {
    logger.warn({ externalId, connectorConfigId, jobId: job.id }, 'Connector item could not be read');
    return;
  }

  await sourceRepository.update(sourceId, item.title, item.uri);
  await documentRepository.updateDocument(documentId, item.title, item.content, item.mimeType);

  const existingChunks = await chunkRepository.listByDocument(documentId);
  await embeddingRepository.deleteByChunkIds(existingChunks.map((chunk) => chunk.id));
  await chunkRepository.deleteByDocument(documentId);

  const content = item.content?.trim() ?? '';
  if (!content) {
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
      connectorKind: config.kind,
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
    });
  }
}
