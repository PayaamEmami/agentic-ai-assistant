import type { Job } from 'bullmq';
import { OpenAIProvider } from '@aaa/ai';
import {
  chunkRepository,
  embeddingRepository,
} from '@aaa/db';
import { logger } from '../lib/logger.js';

export interface EmbeddingJobData {
  chunkIds: string[];
  model: string;
}

export async function handleEmbedding(job: Job<EmbeddingJobData>): Promise<void> {
  const { chunkIds, model } = job.data;
  logger.info({ chunkCount: chunkIds.length, model, jobId: job.id }, 'Processing embedding job');

  const chunks = await chunkRepository.listByIds(chunkIds);
  if (chunks.length === 0) {
    return;
  }

  await embeddingRepository.deleteByChunkIds(chunks.map((chunk) => chunk.id));

  const provider = new OpenAIProvider(
    process.env['OPENAI_API_KEY'] ?? '',
    process.env['OPENAI_MODEL'],
    process.env['OPENAI_EMBEDDING_MODEL'],
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
}
