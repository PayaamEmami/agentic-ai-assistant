import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { handleEmbedding } from './embedding.js';
import type { EmbeddingJobData } from './embedding.js';

const mocks = vi.hoisted(() => ({
  listByIds: vi.fn(),
  deleteByChunkIds: vi.fn(),
  createEmbedding: vi.fn(),
  embed: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  chunkRepository: {
    listByIds: mocks.listByIds,
  },
  embeddingRepository: {
    deleteByChunkIds: mocks.deleteByChunkIds,
    create: mocks.createEmbedding,
  },
}));

vi.mock('@aaa/ai', () => ({
  OpenAIProvider: vi.fn().mockImplementation(function OpenAIProvider() {
    return {
      embed: mocks.embed,
    };
  }),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function job(data: EmbeddingJobData): Job<EmbeddingJobData> {
  return {
    id: 'job-1',
    data,
  } as Job<EmbeddingJobData>;
}

describe('handleEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips jobs when no chunks are found', async () => {
    mocks.listByIds.mockResolvedValue([]);

    await handleEmbedding(
      job({
        chunkIds: ['missing-chunk'],
        model: 'text-embedding-test',
        correlationId: 'correlation-1',
      }),
    );

    expect(mocks.listByIds).toHaveBeenCalledWith(['missing-chunk']);
    expect(mocks.deleteByChunkIds).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.createEmbedding).not.toHaveBeenCalled();
  });

  it('replaces embeddings for each chunk returned by the model provider', async () => {
    mocks.listByIds.mockResolvedValue([
      { id: 'chunk-1', content: 'First chunk' },
      { id: 'chunk-2', content: 'Second chunk' },
    ]);
    mocks.embed.mockResolvedValue({
      model: 'text-embedding-test',
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });

    await handleEmbedding(
      job({
        chunkIds: ['chunk-1', 'chunk-2'],
        model: 'text-embedding-test',
        correlationId: 'correlation-1',
      }),
    );

    expect(mocks.deleteByChunkIds).toHaveBeenCalledWith(['chunk-1', 'chunk-2']);
    expect(mocks.embed).toHaveBeenCalledWith({
      input: ['First chunk', 'Second chunk'],
      model: 'text-embedding-test',
    });
    expect(mocks.createEmbedding).toHaveBeenNthCalledWith(
      1,
      'chunk-1',
      [0.1, 0.2],
      'text-embedding-test',
    );
    expect(mocks.createEmbedding).toHaveBeenNthCalledWith(
      2,
      'chunk-2',
      [0.3, 0.4],
      'text-embedding-test',
    );
  });

  it('fails when the provider omits a vector for a chunk', async () => {
    mocks.listByIds.mockResolvedValue([
      { id: 'chunk-1', content: 'First chunk' },
      { id: 'chunk-2', content: 'Second chunk' },
    ]);
    mocks.embed.mockResolvedValue({
      model: 'text-embedding-test',
      embeddings: [[0.1, 0.2]],
    });

    await expect(
      handleEmbedding(
        job({
          chunkIds: ['chunk-1', 'chunk-2'],
          model: 'text-embedding-test',
          correlationId: 'correlation-1',
        }),
      ),
    ).rejects.toThrow('Missing embedding vector for chunk chunk-2');
    expect(mocks.createEmbedding).toHaveBeenCalledWith(
      'chunk-1',
      [0.1, 0.2],
      'text-embedding-test',
    );
  });
});
