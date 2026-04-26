import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface EmbeddingRow {
  id: string;
  chunkId: string;
  vector: number[] | null;
  model: string;
  createdAt: Date;
}

interface EmbeddingQueryRow {
  id: string;
  chunkId: string;
  vector: string | null;
  model: string;
  createdAt: Date;
}

export interface Embedding extends EmbeddingRow {}

export interface EmbeddingSearchFilters {
  appKinds?: string[];
}

export interface EmbeddingRepository {
  findByChunkId(chunkId: string): Promise<Embedding | null>;
  create(chunkId: string, vector: number[], model: string): Promise<Embedding>;
  deleteByChunkIds(chunkIds: string[]): Promise<void>;
  searchByVector(
    vector: number[],
    limit: number,
    userId?: string,
    filters?: EmbeddingSearchFilters,
  ): Promise<Embedding[]>;
}

function serializeVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function parseVector(raw: string | null): number[] | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length <= 2) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((value) => Number(value));
}

function mapEmbedding(row: EmbeddingQueryRow): Embedding {
  return {
    id: row.id,
    chunkId: row.chunkId,
    vector: parseVector(row.vector),
    model: row.model,
    createdAt: row.createdAt,
  };
}

export const embeddingRepository: EmbeddingRepository = {
  async findByChunkId(chunkId: string): Promise<Embedding | null> {
    const pool = getPool();
    const result = await pool.query<EmbeddingQueryRow>(
      `SELECT id, chunk_id AS "chunkId", vector::text AS "vector", model, created_at AS "createdAt"
       FROM embeddings
       WHERE chunk_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [chunkId],
    );
    const row = result.rows[0];
    return row ? mapEmbedding(row) : null;
  },

  async create(chunkId: string, vector: number[], model: string): Promise<Embedding> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<EmbeddingQueryRow>(
      `INSERT INTO embeddings (id, chunk_id, vector, model)
       VALUES ($1, $2, $3::vector, $4)
       ON CONFLICT (chunk_id, model) DO UPDATE
       SET vector = EXCLUDED.vector,
           created_at = NOW()
       RETURNING id, chunk_id AS "chunkId", vector::text AS "vector", model, created_at AS "createdAt"`,
      [id, chunkId, serializeVector(vector), model],
    );
    return mapEmbedding(result.rows[0]!);
  },

  async deleteByChunkIds(chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) {
      return;
    }
    const pool = getPool();
    await pool.query('DELETE FROM embeddings WHERE chunk_id = ANY($1::uuid[])', [chunkIds]);
  },

  async searchByVector(
    vector: number[],
    limit: number,
    userId?: string,
    filters?: EmbeddingSearchFilters,
  ): Promise<Embedding[]> {
    const pool = getPool();
    const appKinds =
      filters?.appKinds?.map((kind) => kind.trim()).filter((kind) => kind.length > 0) ?? [];
    const hasAppFilter = appKinds.length > 0;

    let query: string;
    let params: Array<string | number | string[]>;

    if (userId) {
      params = [serializeVector(vector), limit, userId];
      const conditions = [
        'e.vector IS NOT NULL',
        '(d.user_id = $3 OR (d.user_id IS NULL AND s.user_id = $3))',
      ];

      if (hasAppFilter) {
        params.push(appKinds);
        conditions.push(`s.app_kind = ANY($${params.length}::text[])`);
      }

      query = `SELECT e.id, e.chunk_id AS "chunkId", e.vector::text AS "vector", e.model, e.created_at AS "createdAt"
               FROM embeddings AS e
               JOIN chunks AS c ON c.id = e.chunk_id
               JOIN documents AS d ON d.id = c.document_id
               LEFT JOIN sources AS s ON s.id = d.source_id
               WHERE ${conditions.join('\n                 AND ')}
               ORDER BY e.vector <=> $1::vector
               LIMIT $2`;
    } else if (hasAppFilter) {
      params = [serializeVector(vector), limit, appKinds];
      query = `SELECT e.id, e.chunk_id AS "chunkId", e.vector::text AS "vector", e.model, e.created_at AS "createdAt"
               FROM embeddings AS e
               JOIN chunks AS c ON c.id = e.chunk_id
               JOIN documents AS d ON d.id = c.document_id
               LEFT JOIN sources AS s ON s.id = d.source_id
               WHERE e.vector IS NOT NULL
                 AND s.app_kind = ANY($3::text[])
               ORDER BY e.vector <=> $1::vector
               LIMIT $2`;
    } else {
      params = [serializeVector(vector), limit];
      query = `SELECT id, chunk_id AS "chunkId", vector::text AS "vector", model, created_at AS "createdAt"
               FROM embeddings
               WHERE vector IS NOT NULL
               ORDER BY vector <=> $1::vector
               LIMIT $2`;
    }

    const result = await pool.query<EmbeddingQueryRow>(query, params);
    return result.rows.map(mapEmbedding);
  },
};
