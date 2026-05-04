import type { Job } from 'bullmq';
import { OpenAIProvider } from '@aaa/ai';
import { loadWorkerConfig } from '@aaa/config';
import { chunkRepository, embeddingRepository } from '@aaa/db';
import type { EmbeddingJobData } from '@aaa/shared';
import { logger } from '../lib/logger.js';

export async function handleEmbedding(job: Job<EmbeddingJobData>): Promise<void> {
  const { chunkIds, model, correlationId } = job.data;
  logger.info(
    {
      event: 'embedding.started',
      outcome: 'start',
      chunkCount: chunkIds.length,
      model,
      jobId: job.id,
      correlationId,
    },
    'Processing embedding job',
  );

  const chunks = await chunkRepository.listByIds(chunkIds);
  if (chunks.length === 0) {
    logger.warn(
      {
        event: 'embedding.skipped',
        outcome: 'failure',
        chunkCount: 0,
        correlationId,
      },
      'No chunks found for embedding job',
    );
    return;
  }

  await embeddingRepository.deleteByChunkIds(chunks.map((chunk) => chunk.id));

  const config = loadWorkerConfig();
  const provider = new OpenAIProvider(
    config.openaiApiKey,
    config.openaiModel,
    config.openaiEmbeddingModel,
  );
  const result = await provider.embed({
    input: chunks.map((chunk) => chunk.content),
    model,
  });

  await Promise.all(
    chunks.map(async (chunk, index) => {
      const vector = result.embeddings[index];
      if (!vector) {
        throw new Error(`Missing embedding vector for chunk ${chunk.id}`);
      }

      await embeddingRepository.create(chunk.id, vector, result.model);
    }),
  );

  logger.info(
    {
      event: 'embedding.completed',
      outcome: 'success',
      chunkCount: chunks.length,
      model: result.model,
      correlationId,
    },
    'Embedding job completed',
  );
}
