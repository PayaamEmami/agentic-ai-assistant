import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface ChunkRow {
  id: string;
  documentId: string;
  content: string;
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface Chunk extends ChunkRow {}

export interface ChunkRepository {
  findById(id: string): Promise<Chunk | null>;
  listByIds(ids: string[]): Promise<Chunk[]>;
  listByDocument(documentId: string): Promise<Chunk[]>;
  create(
    documentId: string,
    content: string,
    index: number,
    tokenCount: number,
    metadata: Record<string, unknown>,
  ): Promise<Chunk>;
  createWithId(
    id: string,
    documentId: string,
    content: string,
    index: number,
    tokenCount: number,
    metadata: Record<string, unknown>,
  ): Promise<Chunk>;
  deleteByDocument(documentId: string): Promise<void>;
}

export const chunkRepository: ChunkRepository = {
  async findById(id: string): Promise<Chunk | null> {
    const pool = getPool();
    const result = await pool.query<ChunkRow>(
      `SELECT id, document_id AS "documentId", content, chunk_index AS "index",
              token_count AS "tokenCount", metadata
       FROM chunks
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByDocument(documentId: string): Promise<Chunk[]> {
    const pool = getPool();
    const result = await pool.query<ChunkRow>(
      `SELECT id, document_id AS "documentId", content, chunk_index AS "index",
              token_count AS "tokenCount", metadata
       FROM chunks
       WHERE document_id = $1
       ORDER BY chunk_index ASC`,
      [documentId],
    );
    return result.rows;
  },

  async listByIds(ids: string[]): Promise<Chunk[]> {
    if (ids.length === 0) {
      return [];
    }

    const pool = getPool();
    const result = await pool.query<ChunkRow>(
      `SELECT id, document_id AS "documentId", content, chunk_index AS "index",
              token_count AS "tokenCount", metadata
       FROM chunks
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return result.rows;
  },

  async create(
    documentId: string,
    content: string,
    index: number,
    tokenCount: number,
    metadata: Record<string, unknown>,
  ): Promise<Chunk> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<ChunkRow>(
      `INSERT INTO chunks (id, document_id, content, chunk_index, token_count, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, document_id AS "documentId", content, chunk_index AS "index",
                 token_count AS "tokenCount", metadata`,
      [id, documentId, content, index, tokenCount, JSON.stringify(metadata)],
    );
    return result.rows[0]!;
  },

  async createWithId(
    id: string,
    documentId: string,
    content: string,
    index: number,
    tokenCount: number,
    metadata: Record<string, unknown>,
  ): Promise<Chunk> {
    const pool = getPool();
    const result = await pool.query<ChunkRow>(
      `INSERT INTO chunks (id, document_id, content, chunk_index, token_count, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, document_id AS "documentId", content, chunk_index AS "index",
                 token_count AS "tokenCount", metadata`,
      [id, documentId, content, index, tokenCount, JSON.stringify(metadata)],
    );
    return result.rows[0]!;
  },

  async deleteByDocument(documentId: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
  },
};
